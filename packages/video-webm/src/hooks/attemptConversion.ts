import type { PayloadRequest } from 'payload'

import fs from 'node:fs/promises'
import { APIError } from 'payload'

import type { Semaphore } from '../core/semaphore.js'
import type {
  ConversionOutcome,
  ConversionRecord,
  ResolvedVideoWebmConfig,
  SkipReason,
  UploadedFile,
} from '../types.js'

import { convertToWebm } from '../core/convert.js'
import { shouldConvert as passesStaticGuards, toWebmFilename } from '../core/shouldConvert.js'

/**
 * `req.context` key that tells the plugin's hooks to stand down for one operation —
 * set on the internal Local API calls that create/delete sidecar derivatives, so a
 * derivative's own pipeline never converts, stamps, or reports again.
 */
export const SKIP_CONTEXT_KEY = 'videoWebmInternalSkip'

export const emptyRecord: ConversionRecord = {
  converted: false,
  encodeDurationMs: null,
  originalFilename: null,
  originalFilesize: null,
  originalMimeType: null,
  skippedReason: null,
}

export const skipRecord = (reason: SkipReason): ConversionRecord => ({
  ...emptyRecord,
  skippedReason: reason,
})

export const skippedOutcome = (
  collection: string,
  file: UploadedFile,
  reason: SkipReason,
): ConversionOutcome => ({
  collection,
  converted: false,
  convertedFilename: null,
  convertedFilesize: null,
  encodeDurationMs: null,
  originalFilename: file.name,
  originalFilesize: file.size,
  originalMimeType: file.mimetype,
  skippedReason: reason,
})

/** Observability must never break an upload — callback errors are logged and dropped. */
export const report = async (
  config: ResolvedVideoWebmConfig,
  req: PayloadRequest,
  outcome: ConversionOutcome,
): Promise<void> => {
  if (!config.onConversionComplete) {
    return
  }
  try {
    await config.onConversionComplete(outcome)
  } catch (error) {
    req.payload.logger.warn(
      `[payload-video-webm] onConversionComplete callback threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export type ConversionAttempt =
  | {
      converted: false
      /** Metadata to stamp for recorded skips; `null` when nothing should be stamped. */
      record: ConversionRecord | null
    }
  | {
      converted: true
      encodeDurationMs: number
      output: Buffer
      record: ConversionRecord
      /** The input with its size normalized — use this for outcome reporting. */
      sourceFile: UploadedFile
    }

/**
 * `req.file.size` is only populated up to `beforeOperation`; by `beforeChange`
 * (where sidecar mode runs) Payload has re-processed the upload and dropped it.
 * The buffer (or the temp file) is the ground truth either way.
 */
const resolveFileSize = async (file: UploadedFile): Promise<number> => {
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0) {
    return file.size
  }
  if (file.tempFilePath) {
    try {
      return (await fs.stat(file.tempFilePath)).size
    } catch {
      // fall through to the in-memory buffer
    }
  }
  return file.data?.byteLength ?? 0
}

/**
 * The mode-independent half of a conversion: guards, predicate, limited encode,
 * size comparison, error policy. Reports every skip to `onConversionComplete`;
 * the caller reports the success outcome once its storage action (swap or sidecar
 * document) has actually happened. Throws `APIError` on failure with
 * `onError: 'throw'`.
 */
export const attemptConversion = async ({
  collectionSlug,
  config,
  file,
  limiter,
  req,
}: {
  collectionSlug: string
  config: ResolvedVideoWebmConfig
  file: UploadedFile
  limiter: null | Semaphore
  req: PayloadRequest
}): Promise<ConversionAttempt> => {
  const upload: UploadedFile = { ...file, size: await resolveFileSize(file) }

  const decision = passesStaticGuards(upload, config)
  if (!decision.convert) {
    // Non-video uploads stay silent; video candidates report their skip.
    if (decision.reason === 'mime-not-matched') {
      return { converted: false, record: null }
    }
    let record: ConversionRecord | null = null
    if (decision.reason === 'input-too-large') {
      req.payload.logger.warn(
        `[payload-video-webm] skipping "${upload.name}" (${upload.size} bytes): larger than maxInputFileSize`,
      )
      record = skipRecord(decision.reason)
    }
    await report(config, req, skippedOutcome(collectionSlug, upload, decision.reason))
    return { converted: false, record }
  }

  // Runs after the static guards, so it only vetoes files that would otherwise
  // convert. Exceptions deliberately propagate past onError: a throwing predicate
  // is a config bug, not an encode failure. Vetoes are reported (observability
  // must not have holes) but not stamped — an intentional veto is not an anomaly.
  if (config.shouldConvert) {
    const approved = await config.shouldConvert({ collection: collectionSlug, file: upload, req })
    if (!approved) {
      await report(config, req, skippedOutcome(collectionSlug, upload, 'filtered'))
      return { converted: false, record: null }
    }
  }

  let output: Buffer
  let encodeDurationMs: number
  const release = limiter ? await limiter.acquire() : null
  try {
    const startedAt = Date.now()
    output = await convertToWebm({
      config,
      data: upload.data,
      inputPath: upload.tempFilePath,
      originalName: upload.name,
    })
    encodeDurationMs = Date.now() - startedAt
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (config.onError === 'skip') {
      req.payload.logger.warn(
        `[payload-video-webm] storing "${upload.name}" unconverted, conversion failed: ${message}`,
      )
      await report(config, req, skippedOutcome(collectionSlug, upload, 'ffmpeg-failed'))
      return { converted: false, record: skipRecord('ffmpeg-failed') }
    }
    throw new APIError(`[payload-video-webm] failed to convert "${upload.name}": ${message}`, 500)
  } finally {
    release?.()
  }

  if (config.skipIfLarger && output.byteLength >= upload.size) {
    req.payload.logger.info(
      `[payload-video-webm] keeping original "${upload.name}": WebM output would be larger (${output.byteLength} >= ${upload.size} bytes)`,
    )
    await report(config, req, skippedOutcome(collectionSlug, upload, 'output-larger'))
    return { converted: false, record: skipRecord('output-larger') }
  }

  return {
    converted: true,
    encodeDurationMs,
    output,
    record: {
      converted: true,
      encodeDurationMs,
      originalFilename: upload.name,
      originalFilesize: upload.size,
      originalMimeType: upload.mimetype,
      skippedReason: null,
    },
    sourceFile: upload,
  }
}

/** Success outcome for the caller to report once its storage action completed. */
export const convertedOutcome = (
  collectionSlug: string,
  file: UploadedFile,
  output: Buffer,
  encodeDurationMs: number,
): ConversionOutcome => ({
  collection: collectionSlug,
  converted: true,
  convertedFilename: toWebmFilename(file.name),
  convertedFilesize: output.byteLength,
  encodeDurationMs,
  originalFilename: file.name,
  originalFilesize: file.size,
  originalMimeType: file.mimetype,
  skippedReason: null,
})

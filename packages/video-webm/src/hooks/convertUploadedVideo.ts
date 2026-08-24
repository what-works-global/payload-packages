import type { CollectionBeforeOperationHook, PayloadRequest } from 'payload'

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
import { WEBM_MIME_TYPE } from '../core/defaults.js'
import { shouldConvert as passesStaticGuards, toWebmFilename } from '../core/shouldConvert.js'

/** `req.context` key the conversion outcome is stashed under for the metadata stamp hook. */
export const VIDEO_WEBM_CONTEXT_KEY = 'videoWebm'

const skipRecord = (reason: SkipReason): ConversionRecord => ({
  converted: false,
  encodeDurationMs: null,
  originalFilename: null,
  originalFilesize: null,
  originalMimeType: null,
  skippedReason: reason,
})

const skippedOutcome = (
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
const report = async (
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

/**
 * Converts an incoming video upload to WebM by swapping `req.file` before Payload
 * processes it. Because the swap happens ahead of `generateFileData`, Payload derives
 * filename, mimeType and filesize from the converted file and hands it to whichever
 * storage adapter the collection uses — no filesystem coupling, no second write.
 *
 * The plugin appends this hook after any `beforeOperation` hooks the collection
 * already declares, so those still see the original upload; every later hook stage
 * (`beforeValidate`, `beforeChange`, …) sees the converted WebM.
 */
export const createConvertHook = (
  config: ResolvedVideoWebmConfig,
  limiter: null | Semaphore,
): CollectionBeforeOperationHook => {
  return async ({ collection, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return
    }

    const file = req.file
    if (!file) {
      return
    }

    const collectionSlug = collection.slug

    const decision = passesStaticGuards(file, config)
    if (!decision.convert) {
      // Non-video uploads stay silent; video candidates report their skip.
      if (decision.reason === 'mime-not-matched') {
        return
      }
      if (decision.reason === 'input-too-large') {
        req.payload.logger.warn(
          `[payload-video-webm] skipping "${file.name}" (${file.size} bytes): larger than maxInputFileSize`,
        )
        req.context[VIDEO_WEBM_CONTEXT_KEY] = skipRecord(decision.reason)
      }
      await report(config, req, skippedOutcome(collectionSlug, file, decision.reason))
      return
    }

    // Runs after the static guards, so it only vetoes files that would otherwise
    // convert. Exceptions deliberately propagate past onError: a throwing predicate
    // is a config bug, not an encode failure. Vetoes are reported (observability
    // must not have holes) but not stamped — an intentional veto is not an anomaly.
    if (config.shouldConvert) {
      const approved = await config.shouldConvert({ collection: collectionSlug, file, req })
      if (!approved) {
        await report(config, req, skippedOutcome(collectionSlug, file, 'filtered'))
        return
      }
    }

    let output: Buffer
    let encodeDurationMs: number
    const release = limiter ? await limiter.acquire() : null
    try {
      const startedAt = Date.now()
      output = await convertToWebm({
        config,
        data: file.data,
        inputPath: file.tempFilePath,
        originalName: file.name,
      })
      encodeDurationMs = Date.now() - startedAt
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (config.onError === 'skip') {
        req.payload.logger.warn(
          `[payload-video-webm] storing "${file.name}" unconverted, conversion failed: ${message}`,
        )
        req.context[VIDEO_WEBM_CONTEXT_KEY] = skipRecord('ffmpeg-failed')
        await report(config, req, skippedOutcome(collectionSlug, file, 'ffmpeg-failed'))
        return
      }
      throw new APIError(`[payload-video-webm] failed to convert "${file.name}": ${message}`, 500)
    } finally {
      release?.()
    }

    if (config.skipIfLarger && output.byteLength >= file.size) {
      req.payload.logger.info(
        `[payload-video-webm] keeping original "${file.name}": WebM output would be larger (${output.byteLength} >= ${file.size} bytes)`,
      )
      req.context[VIDEO_WEBM_CONTEXT_KEY] = skipRecord('output-larger')
      await report(config, req, skippedOutcome(collectionSlug, file, 'output-larger'))
      return
    }

    const outcome: ConversionOutcome = {
      collection: collectionSlug,
      converted: true,
      convertedFilename: toWebmFilename(file.name),
      convertedFilesize: output.byteLength,
      encodeDurationMs,
      originalFilename: file.name,
      originalFilesize: file.size,
      originalMimeType: file.mimetype,
      skippedReason: null,
    }

    req.context[VIDEO_WEBM_CONTEXT_KEY] = {
      converted: true,
      encodeDurationMs,
      originalFilename: file.name,
      originalFilesize: file.size,
      originalMimeType: file.mimetype,
      skippedReason: null,
    } satisfies ConversionRecord

    // Payload reads from tempFilePath (not `data`) when present, so keep both in sync.
    if (file.tempFilePath) {
      await fs.writeFile(file.tempFilePath, output)
    }
    file.data = output
    file.mimetype = WEBM_MIME_TYPE
    file.name = outcome.convertedFilename ?? file.name
    file.size = output.byteLength

    await report(config, req, outcome)
  }
}

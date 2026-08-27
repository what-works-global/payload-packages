import type { PayloadRequest } from 'payload'

import fs from 'node:fs/promises'

import type { Semaphore } from '../core/semaphore.js'
import type {
  ConversionOutcome,
  ConversionRecord,
  ResolvedVideoWebmConfig,
  UploadedFile,
} from '../types.js'

import { convertToWebm } from '../core/convert.js'

/**
 * `req.context` key that tells the plugin's hooks to stand down for one operation —
 * set on the internal Local API calls that create/delete sidecar documents and on
 * the job's own updates, so plugin-made writes never re-queue conversions.
 */
export const SKIP_CONTEXT_KEY = 'videoWebmInternalSkip'

export const emptyRecord: ConversionRecord = {
  encodeDurationMs: null,
  error: null,
  originalFilename: null,
  originalFilesize: null,
  originalMimeType: null,
  skippedReason: null,
  status: null,
}

/** A relationship value may arrive as an id or a populated document. */
export const relationId = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') {
      return id
    }
  }
  return null
}

/**
 * `req.file.size` is only populated up to `beforeOperation`; later hook stages get
 * the upload re-processed with the size dropped. The buffer (or the temp file) is
 * the ground truth either way.
 */
export const resolveFileSize = async (file: UploadedFile): Promise<number> => {
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

/** Observability must never break an upload or a job — callback errors are logged and dropped. */
export const report = async (
  config: ResolvedVideoWebmConfig,
  logger: PayloadRequest['payload']['logger'],
  outcome: ConversionOutcome,
): Promise<void> => {
  if (!config.onConversionComplete) {
    return
  }
  try {
    await config.onConversionComplete(outcome)
  } catch (error) {
    logger.warn(
      `[payload-video-webm] onConversionComplete callback threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Runs one encode under the plugin's concurrency limiter, returning the WebM bytes
 * and the wall-clock encode duration. The permit is released in `finally`, so
 * failures and timeouts can never starve later encodes.
 */
export const encodeLimited = async (
  config: ResolvedVideoWebmConfig,
  limiter: null | Semaphore,
  source: { data: Buffer; name: string },
): Promise<{ encodeDurationMs: number; output: Buffer }> => {
  const release = limiter ? await limiter.acquire() : null
  try {
    const startedAt = Date.now()
    const output = await convertToWebm({
      config,
      data: source.data,
      originalName: source.name,
    })
    return { encodeDurationMs: Date.now() - startedAt, output }
  } finally {
    release?.()
  }
}

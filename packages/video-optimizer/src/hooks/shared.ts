import type { PayloadRequest } from 'payload'

import fs from 'node:fs/promises'

import type { FocalPoint } from '../core/args.js'
import type { Semaphore } from '../core/semaphore.js'
import type {
  ConversionOutcome,
  ConversionRecord,
  ResolvedVideoOptimizerConfig,
  UploadedFile,
} from '../types.js'

import { encodeToFile } from '../core/convert.js'

/**
 * `req.context` key that tells the plugin's hooks to stand down for one operation —
 * set on the internal Local API calls that create/delete sidecar documents and on
 * the job's own updates, so plugin-made writes never re-queue conversions.
 */
export const SKIP_CONTEXT_KEY = 'videoConversionInternalSkip'

/**
 * `req.context` key set by the beforeChange stamp hook and consumed by the
 * afterChange queue hook, which is how the two halves of one upload agree that a
 * conversion is wanted. Deliberately not read back off the stamped document: with
 * `metadataFields: false` there is no field to read, and the queue hook would never
 * fire at all.
 */
export const QUEUE_CONTEXT_KEY = 'videoConversionQueuePending'

/**
 * `req.context` key that authorises the cleanup hook to delete sidecars whose rows
 * disappeared. Only writes that genuinely retire renditions set it (the regenerate
 * endpoint); a plain document save or a version restore must never take real files
 * down with it just because its snapshot of `renditions` is older.
 */
export const GC_CONTEXT_KEY = 'videoConversionAllowGc'

/**
 * Runs one internal Local API call with the skip flag set, then restores the
 * request's context. Passing `context` to the Local API would otherwise leave the
 * flag on the *caller's* request — Payload assigns the merged context back onto the
 * same request object — silently disabling the plugin's hooks for the rest of the
 * operation (the remaining documents of a bulk delete, for instance).
 */
export const withSkipContext = async <T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> => {
  const previous = req.context
  req.context = { ...previous, [SKIP_CONTEXT_KEY]: true }
  try {
    return await fn()
  } finally {
    req.context = previous
  }
}

/** Poll interval and bound for {@link waitForTransaction}. */
const TRANSACTION_POLL_MS = 10
const TRANSACTION_WAIT_MS = 30_000

/**
 * The request's open transaction id, or `null` when this database has none.
 *
 * Payload parks `beginTransaction()`'s *promise* on the request and only replaces it
 * with the real id once the adapter reports one. Adapters that don't support
 * transactions (or have them disabled) leave that settled promise behind forever, so
 * a plain truthiness check would see an open transaction on every single request and
 * wait for a commit that is never coming.
 */
export const openTransaction = async (req: PayloadRequest): Promise<null | number | string> => {
  const pending = req.transactionID
  if (pending && typeof pending === 'object' && 'then' in pending) {
    await pending
  }
  const id = req.transactionID
  return typeof id === 'number' || typeof id === 'string' ? id : null
}

/**
 * Waits for the operation's database transaction to settle. Payload deletes
 * `req.transactionID` when it commits *and* when it rolls back, so this resolves
 * either way — it only guarantees that the surrounding write is no longer pending.
 *
 * Without it, a conversion started from an `afterChange` hook queries the database
 * on its own connection while the upload is still uncommitted (Postgres, or Mongo
 * with transactions), finds nothing, and mistakes a perfectly good document for a
 * rolled-back one.
 */
export const waitForTransaction = async (
  req: PayloadRequest,
  timeoutMs: number = TRANSACTION_WAIT_MS,
): Promise<void> => {
  if (!(await openTransaction(req))) {
    return
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const id = req.transactionID
    if (typeof id !== 'number' && typeof id !== 'string') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, TRANSACTION_POLL_MS))
  }
}

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
  config: ResolvedVideoOptimizerConfig,
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
      `[payload-video-optimizer] onConversionComplete callback threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Runs one encode under the plugin's concurrency limiter, reporting the wall-clock
 * ffmpeg time. File in, file out: the caller owns both paths, so a whole video is
 * never held in memory. The permit is released in `finally`, so failures and
 * timeouts can never starve later encodes.
 */
export const encodeLimited = async (
  config: ResolvedVideoOptimizerConfig,
  limiter: null | Semaphore,
  paths: { focal?: FocalPoint; inputPath: string; outputPath: string },
): Promise<{ encodeDurationMs: number }> => {
  const release = limiter ? await limiter.acquire() : null
  try {
    const startedAt = Date.now()
    await encodeToFile({
      config,
      focal: paths.focal,
      inputPath: paths.inputPath,
      outputPath: paths.outputPath,
    })
    return { encodeDurationMs: Date.now() - startedAt }
  } finally {
    release?.()
  }
}

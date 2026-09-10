import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, JsonObject } from 'payload'

import type {
  ConversionRecord,
  Dispatch,
  ResolvedVideoOptimizerConfig,
  SkipReason,
  UploadedFile,
} from '../types.js'

import { requestOrigin } from '../core/chain.js'
import { shouldConvert as passesStaticGuards } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import { RENDITION_GENERATION_FIELD_NAME, RENDITIONS_FIELD_NAME } from '../fields/sidecarFields.js'
import {
  emptyRecord,
  openTransaction,
  QUEUE_CONTEXT_KEY,
  report,
  resolveFileSize,
  SKIP_CONTEXT_KEY,
  waitForTransaction,
} from './shared.js'

const skippedOutcome = (collection: string, file: UploadedFile, reason: SkipReason) => ({
  collection,
  converted: false,
  convertedFilename: null,
  convertedFilesize: null,
  // These decisions happen in beforeChange, where a new document has no id yet.
  docId: null,
  encodeDurationMs: null,
  error: null,
  originalFilename: file.name,
  originalFilesize: file.size,
  originalMimeType: file.mimetype,
  preset: null,
  skippedReason: reason,
})

/**
 * Upload-time half of the pipeline: evaluates the cheap guards synchronously and
 * stamps the metadata group — `queued` for candidates (the afterChange hook reads
 * that and enqueues the job), `skipped` for recorded skips, cleared for everything
 * else. Runs only when this very request carried a file, so re-saving a document
 * never clobbers the record, while replacing the file resets it (and the stale
 * sidecar link, which the cleanup hook then garbage-collects).
 */
export const createStampHook = (
  config: ResolvedVideoOptimizerConfig,
): CollectionBeforeChangeHook => {
  return async ({ collection, data, operation, originalDoc, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return data
    }
    if (req.context[SKIP_CONTEXT_KEY]) {
      return data
    }

    const generation = Number(
      (originalDoc as JsonObject | undefined)?.[RENDITION_GENERATION_FIELD_NAME],
    )
    const file = req.file
    if (!file) {
      // Payload never sets `req.file` when duplicating a document — it copies the
      // stored file internally — so an unguarded create would carry the source's
      // `renditions` over to the copy. Both documents would then point at the same
      // sidecars, and deleting the copy would delete the original's renditions.
      if (operation === 'create') {
        return {
          ...(data as JsonObject),
          ...(config.metadataFields ? { [METADATA_GROUP_NAME]: emptyRecord } : {}),
          [RENDITION_GENERATION_FIELD_NAME]: 1,
          [RENDITIONS_FIELD_NAME]: [],
        }
      }
      return data
    }

    const collectionSlug = collection.slug
    const upload: UploadedFile = { ...file, size: await resolveFileSize(file) }

    let record: ConversionRecord = emptyRecord

    const decision = passesStaticGuards(upload, config)
    if (decision.convert) {
      // Vetoes are reported (observability must not have holes) but not stamped —
      // an intentional veto is not an anomaly. Exceptions deliberately propagate:
      // a throwing predicate is a config bug.
      const approved = config.shouldConvert
        ? await config.shouldConvert({ collection: collectionSlug, file: upload, req })
        : true
      if (approved) {
        record = {
          ...emptyRecord,
          originalFilename: upload.name,
          originalFilesize: upload.size,
          originalMimeType: upload.mimetype,
          status: 'queued',
        }
        // The afterChange half of the pipeline reads this, not the stamped status:
        // with `metadataFields: false` there is no status field to read, and every
        // upload would silently go unconverted.
        req.context[QUEUE_CONTEXT_KEY] = true
      } else {
        await report(config, req.payload.logger, skippedOutcome(collectionSlug, upload, 'filtered'))
      }
    } else if (decision.reason === 'input-too-large') {
      req.payload.logger.warn(
        `[payload-video-optimizer] skipping "${upload.name}" (${upload.size} bytes): larger than maxInputFileSize`,
      )
      record = {
        ...emptyRecord,
        originalFilename: upload.name,
        originalFilesize: upload.size,
        originalMimeType: upload.mimetype,
        skippedReason: decision.reason,
        status: 'skipped',
      }
      await report(
        config,
        req.payload.logger,
        skippedOutcome(collectionSlug, upload, decision.reason),
      )
    } else if (decision.reason === 'already-webm') {
      await report(
        config,
        req.payload.logger,
        skippedOutcome(collectionSlug, upload, decision.reason),
      )
    }
    // mime-not-matched (images etc.) stays silent — the record is just cleared.

    return {
      ...(data as JsonObject),
      ...(config.metadataFields ? { [METADATA_GROUP_NAME]: record } : {}),
      // A new file supersedes every job queued against the old one.
      [RENDITION_GENERATION_FIELD_NAME]: (Number.isFinite(generation) ? generation : 0) + 1,
      [RENDITIONS_FIELD_NAME]: [],
    }
  }
}

export interface QueueHookOptions {
  dispatch: Dispatch | null
  queue: string
  taskSlug: string
}

/**
 * Writes the durable job row and hands the run to the host's `dispatch` — or runs
 * it inline when none is set. Shared by the afterChange hook and the regenerate
 * endpoint.
 *
 * `jobs.queue` is deliberately called without `req`: inside the request's
 * transaction the row would be invisible to a same-tick `runByID`. The cost is an
 * orphaned job when the operation rolls back — the handler bails quietly when the
 * document is missing.
 */
export const queueConversionJob = async ({
  collection,
  dispatch,
  docId,
  generation,
  queue,
  req,
  sourceFilename,
  taskSlug,
}: {
  collection: string
  docId: number | string
  generation: number
  req: Parameters<CollectionAfterChangeHook>[0]['req']
  sourceFilename: string
} & QueueHookOptions): Promise<void> => {
  // Captured here because the task's own `req` is synthetic — `runByID` is called
  // without one, so by the time the job runs there is no request to read a host from.
  const origin = requestOrigin(req)
  // Apps with generated types narrow task slugs to their literal union, which a
  // library cannot know — hence the cast on the way in and out.
  const job = (await req.payload.jobs.queue({
    input: { collection, docId, generation, origin, sourceFilename },
    queue,
    task: taskSlug,
  } as never)) as { id: number | string }

  const run = async (): Promise<void> => {
    // The job reads the document on its own connection, so it must not start until
    // the write that triggered it is committed and visible.
    await waitForTransaction(req)
    try {
      await req.payload.jobs.runByID({ id: job.id })
    } catch (error) {
      // The durable row remains; the jobs queue (cron / jobs:run) will pick it up.
      req.payload.logger.warn(
        `[payload-video-optimizer] immediate conversion run failed for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (dispatch) {
    await dispatch(
      { collection, docId, generation, jobId: job.id, origin, sourceFilename },
      { req, run },
    )
    return
  }
  if (await openTransaction(req)) {
    // No dispatch, but a transaction is open: awaiting the run here would deadlock
    // it against the commit it is waiting for, so it starts detached instead. The
    // durable row (plus retries and cron) covers a process that dies in between.
    void run()
    return
  }
  // No transaction to wait for: run inline and make the caller wait. Slow beats a
  // floating promise that resumes inside someone else's request on a frozen
  // serverless instance — the boot warning tells hosts how to background it.
  await run()
}

/** Enqueues the conversion once the document (and its file) exist. */
export const createQueueHook = ({
  dispatch,
  queue,
  taskSlug,
}: QueueHookOptions): CollectionAfterChangeHook => {
  return async ({ collection, doc, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return doc
    }
    if (req.context[SKIP_CONTEXT_KEY] || !req.context[QUEUE_CONTEXT_KEY]) {
      return doc
    }
    // Consumed here so the flag can never leak onto a later document in the same
    // request (a bulk update runs both hooks once per document).
    delete req.context[QUEUE_CONTEXT_KEY]

    await queueConversionJob({
      collection: collection.slug,
      dispatch,
      docId: (doc as JsonObject).id as number | string,
      generation: Number((doc as JsonObject)[RENDITION_GENERATION_FIELD_NAME] ?? 0),
      queue,
      req,
      sourceFilename: String((doc as JsonObject).filename),
      taskSlug,
    })

    return doc
  }
}

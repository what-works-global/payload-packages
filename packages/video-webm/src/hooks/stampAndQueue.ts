import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, JsonObject } from 'payload'

import type {
  ConversionRecord,
  Dispatch,
  ResolvedVideoWebmConfig,
  SkipReason,
  UploadedFile,
} from '../types.js'

import { shouldConvert as passesStaticGuards } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import { WEBM_VERSIONS_FIELD_NAME } from '../fields/sidecarFields.js'
import { emptyRecord, report, resolveFileSize, SKIP_CONTEXT_KEY } from './shared.js'

const skippedOutcome = (collection: string, file: UploadedFile, reason: SkipReason) => ({
  collection,
  converted: false,
  convertedFilename: null,
  convertedFilesize: null,
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
export const createStampHook = (config: ResolvedVideoWebmConfig): CollectionBeforeChangeHook => {
  return async ({ collection, data, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return data
    }
    if (req.context[SKIP_CONTEXT_KEY]) {
      return data
    }
    const file = req.file
    if (!file) {
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
      } else {
        await report(config, req.payload.logger, skippedOutcome(collectionSlug, upload, 'filtered'))
      }
    } else if (decision.reason === 'input-too-large') {
      req.payload.logger.warn(
        `[payload-video-webm] skipping "${upload.name}" (${upload.size} bytes): larger than maxInputFileSize`,
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
      [WEBM_VERSIONS_FIELD_NAME]: [],
    }
  }
}

export interface QueueHookOptions {
  dispatch: Dispatch | null
  queue: string
  taskSlug: string
}

/**
 * Enqueues the durable conversion job once the document (and its file) exist, then
 * hands the run to the host's `dispatch` — or runs it inline when none is set.
 *
 * `jobs.queue` is deliberately called without `req`: inside the request's
 * transaction the row would be invisible to a same-tick `runByID`. The cost is an
 * orphaned job when the operation rolls back — the handler bails quietly when the
 * document is missing.
 */
export const createQueueHook = ({
  dispatch,
  queue,
  taskSlug,
}: QueueHookOptions): CollectionAfterChangeHook => {
  return async ({ collection, doc, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return doc
    }
    if (req.context[SKIP_CONTEXT_KEY] || !req.file) {
      return doc
    }
    const record = (doc as JsonObject)[METADATA_GROUP_NAME] as ConversionRecord | undefined
    if (record?.status !== 'queued') {
      return doc
    }

    // Apps with generated types narrow task slugs to their literal union, which a
    // library cannot know — hence the cast on the way in and out.
    const job = (await req.payload.jobs.queue({
      input: {
        collection: collection.slug,
        docId: (doc as JsonObject).id as number | string,
        sourceFilename: String((doc as JsonObject).filename),
      },
      queue,
      task: taskSlug,
    } as never)) as { id: number | string }

    const run = async (): Promise<void> => {
      try {
        await req.payload.jobs.runByID({ id: job.id })
      } catch (error) {
        // The durable row remains; the jobs queue (cron / jobs:run) will pick it up.
        req.payload.logger.warn(
          `[payload-video-webm] immediate conversion run failed for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (dispatch) {
      await dispatch(
        {
          collection: collection.slug,
          docId: (doc as JsonObject).id as number | string,
          jobId: job.id,
          sourceFilename: String((doc as JsonObject).filename),
        },
        { req, run },
      )
    } else {
      // No dispatch configured: run inline (the upload waits). Slow beats a floating
      // promise that resumes inside someone else's request on a frozen serverless
      // instance — the boot warning tells hosts how to background it.
      await run()
    }

    return doc
  }
}

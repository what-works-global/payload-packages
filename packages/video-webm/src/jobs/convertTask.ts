import type { JsonObject, Payload, PayloadRequest, TaskConfig, TaskHandler } from 'payload'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { Semaphore } from '../core/semaphore.js'
import type { ConversionOutcome, ResolvedVideoWebmConfig } from '../types.js'

import { asCollectionSlug, asTaskSlug } from '../core/collectionSlug.js'
import { toWebmFilename } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import { WEBM_VERSIONS_FIELD_NAME } from '../fields/sidecarFields.js'
import { encodeLimited, report, SKIP_CONTEXT_KEY } from '../hooks/shared.js'
import { createSidecarDocument, webmVersionRows } from '../hooks/webmSidecar.js'

export interface ConvertTaskRegistryEntry {
  config: ResolvedVideoWebmConfig
  limiter: null | Semaphore
}

interface ConvertTaskInput {
  collection: string
  docId: number | string
  sourceFilename: string
}

/**
 * Reads the source video's bytes without knowing the storage backend: local
 * storage straight from `staticDir`, anything else over HTTP via the document's
 * own URL (which needs `serverURL` set and readable files — `fetchSource`
 * overrides this for access-controlled storage).
 */
const readSource = async (
  payload: Payload,
  collectionSlug: string,
  doc: JsonObject,
  config: ResolvedVideoWebmConfig,
): Promise<Buffer> => {
  if (config.fetchSource) {
    return config.fetchSource({ collection: collectionSlug, doc, payload })
  }

  const upload = payload.collections[asCollectionSlug(collectionSlug)]?.config.upload
  const staticDir = upload && typeof upload === 'object' ? upload.staticDir : undefined
  const localDisabled = upload && typeof upload === 'object' ? upload.disableLocalStorage : false

  if (staticDir && !localDisabled) {
    const dir = path.isAbsolute(staticDir) ? staticDir : path.resolve(process.cwd(), staticDir)
    return fs.readFile(path.join(dir, String(doc.filename)))
  }

  const base = payload.config.serverURL || 'http://localhost:3000'
  const url = new URL(String(doc.url), base)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `[payload-video-webm] could not fetch source "${url.href}" (HTTP ${response.status}) — set serverURL, make files readable, or provide fetchSource`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

const updateRecord = async (
  payload: Payload,
  collectionSlug: string,
  docId: number | string,
  data: JsonObject,
): Promise<void> => {
  await payload.update({
    id: docId,
    collection: asCollectionSlug(collectionSlug),
    context: { [SKIP_CONTEXT_KEY]: true },
    data,
    depth: 0,
    overrideAccess: true,
  })
}

/**
 * The durable conversion job: encodes one sidecar rendition per configured preset.
 * Idempotent by design — the immediate post-upload run, retries, and the cron
 * safety net can all pick it up: it bails quietly when the document is gone
 * (orphan row after a rollback) or its file was replaced since queueing, and it
 * only encodes presets that don't have a rendition yet, so a retry after a partial
 * failure resumes instead of duplicating. On failure it links whatever renditions
 * finished, records the error on the document, and rethrows so Payload's retries
 * (and only they) run it again.
 */
export const createConvertTask = (
  taskSlug: string,
  retries: number,
  registry: Map<string, ConvertTaskRegistryEntry>,
): TaskConfig => {
  const handler = (async ({ input, req }: { input: unknown; req: PayloadRequest }) => {
    const { collection, docId, sourceFilename } = input as ConvertTaskInput
    const entry = registry.get(collection)
    if (!entry) {
      return { output: {} }
    }
    const { config, limiter } = entry
    const payload = req.payload

    let doc: JsonObject
    try {
      doc = (await payload.findByID({
        id: docId,
        collection: asCollectionSlug(collection),
        depth: 0,
      })) as JsonObject
    } catch {
      return { output: {} } // document rolled back or deleted — orphan job, done.
    }
    if (doc.filename !== sourceFilename) {
      return { output: {} } // file replaced since queueing — a newer job owns it.
    }

    const rows = webmVersionRows(doc)
    const done = new Set(rows.map((row) => row.preset))
    const pending = Object.entries(config.presets).filter(([name]) => !done.has(name))
    const status = (doc[METADATA_GROUP_NAME] as JsonObject | undefined)?.status
    if (status === 'skipped') {
      return { output: {} } // deliberately unconverted (output-larger) — nothing to resume.
    }
    if (pending.length === 0 && status === 'complete') {
      return { output: {} } // every rendition exists — collision with another run.
    }

    const baseRecord = {
      encodeDurationMs: null as null | number,
      error: null as null | string,
      originalFilename: String(doc.filename),
      originalFilesize: Number(doc.filesize),
      originalMimeType: String(doc.mimeType),
      skippedReason: null as ConversionOutcome['skippedReason'],
    }
    const outcomeBase = {
      collection,
      originalFilename: baseRecord.originalFilename,
      originalFilesize: baseRecord.originalFilesize,
      originalMimeType: baseRecord.originalMimeType,
    }
    const skippedOutcome = (preset: string, encodeDurationMs: number): ConversionOutcome => ({
      ...outcomeBase,
      converted: false,
      convertedFilename: null,
      convertedFilesize: null,
      encodeDurationMs,
      error: null,
      preset,
      skippedReason: 'output-larger',
    })

    let totalEncodeMs = 0
    let anyStored = rows.length > 0
    let allLarger = true

    try {
      const source = await readSource(payload, collection, doc, config)

      for (const [preset, resolved] of pending) {
        const { encodeDurationMs, output } = await encodeLimited(
          { ...config, encoding: resolved.encoding },
          limiter,
          { name: String(doc.filename), data: source },
        )
        totalEncodeMs += encodeDurationMs

        if (config.skipIfLarger && output.byteLength >= source.byteLength) {
          payload.logger.info(
            `[payload-video-webm] not storing "${preset}" for "${doc.filename}": output would be larger (${output.byteLength} >= ${source.byteLength} bytes)`,
          )
          await report(config, payload.logger, skippedOutcome(preset, encodeDurationMs))
          continue
        }

        allLarger = false
        anyStored = true
        const sidecarId = await createSidecarDocument(payload, collection, doc, output, preset)
        rows.push({ preset, video: sidecarId })
        await report(config, payload.logger, {
          ...outcomeBase,
          converted: true,
          convertedFilename: toWebmFilename(String(doc.filename), preset),
          convertedFilesize: output.byteLength,
          encodeDurationMs,
          error: null,
          preset,
          skippedReason: null,
        })
      }

      await updateRecord(payload, collection, docId, {
        [METADATA_GROUP_NAME]: anyStored
          ? { ...baseRecord, encodeDurationMs: totalEncodeMs, status: 'complete' }
          : {
              ...baseRecord,
              encodeDurationMs: totalEncodeMs,
              skippedReason: allLarger ? 'output-larger' : null,
              status: 'skipped',
            },
        [WEBM_VERSIONS_FIELD_NAME]: rows,
      })
      return { output: {} }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      payload.logger.warn(
        `[payload-video-webm] conversion job failed for "${doc.filename}" (${collection}/${String(docId)}): ${message}`,
      )
      try {
        // Keep whatever renditions finished linked — the retry resumes the rest.
        await updateRecord(payload, collection, docId, {
          [METADATA_GROUP_NAME]: { ...baseRecord, error: message.slice(0, 500), status: 'failed' },
          [WEBM_VERSIONS_FIELD_NAME]: rows,
        })
      } catch {
        // recording the failure is best-effort; the rethrow below is what matters.
      }
      await report(config, payload.logger, {
        ...outcomeBase,
        converted: false,
        convertedFilename: null,
        convertedFilesize: null,
        encodeDurationMs: null,
        error: message,
        preset: null,
        skippedReason: null,
      })
      throw error // let Payload's retries re-run the job.
    }
    // Apps with generated types narrow TaskHandler to their task union, which a
    // library cannot know — hence the cast below.
  }) as unknown as TaskHandler<never>

  return {
    slug: asTaskSlug(taskSlug),
    handler,
    inputSchema: [
      { name: 'collection', type: 'text', required: true },
      // json preserves the id's type — text would corrupt numeric ids.
      { name: 'docId', type: 'json', required: true },
      { name: 'sourceFilename', type: 'text', required: true },
    ],
    retries,
  }
}

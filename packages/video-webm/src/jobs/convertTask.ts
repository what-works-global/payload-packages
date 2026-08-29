import type { JsonObject, Payload, PayloadRequest, TaskConfig, TaskHandler } from 'payload'

import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { Semaphore } from '../core/semaphore.js'
import type { WebmVersionRow } from '../hooks/webmSidecar.js'
import type { ConversionStatus, ResolvedVideoWebmConfig, SkipReason } from '../types.js'

import { CENTRE_FOCAL_POINT } from '../core/args.js'
import { asCollectionSlug, asTaskSlug } from '../core/collectionSlug.js'
import { probeVideoDimensions, tempInputName } from '../core/convert.js'
import { redundantPresets } from '../core/defaults.js'
import { KeyedMutex } from '../core/keyedMutex.js'
import { toWebmFilename } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import { WEBM_GENERATION_FIELD_NAME, WEBM_VERSIONS_FIELD_NAME } from '../fields/sidecarFields.js'
import { encodeLimited, relationId, report, SKIP_CONTEXT_KEY } from '../hooks/shared.js'
import {
  createSidecarDocument,
  deleteSidecarDocument,
  rowVideoIds,
  webmVersionRows,
} from '../hooks/webmSidecar.js'

export interface ConvertTaskRegistryEntry {
  config: ResolvedVideoWebmConfig
  limiter: null | Semaphore
}

interface ConvertTaskInput {
  collection: string
  docId: number | string
  /** Absent on rows queued by an older version of the plugin — then unenforced. */
  generation?: number
  sourceFilename: string
}

/** Resolves the collection's local upload directory, or `null` for remote storage. */
const localSourcePath = (
  payload: Payload,
  collectionSlug: string,
  doc: JsonObject,
): null | string => {
  const upload = payload.collections[asCollectionSlug(collectionSlug)]?.config.upload
  if (!upload || typeof upload !== 'object' || upload.disableLocalStorage || !upload.staticDir) {
    return null
  }
  const dir = path.isAbsolute(upload.staticDir)
    ? upload.staticDir
    : path.resolve(process.cwd(), upload.staticDir)
  // Payload sanitizes filenames on upload, but this path is assembled from stored
  // data — `basename` keeps a hand-written or migrated value from escaping the
  // upload directory.
  return path.join(dir, path.basename(String(doc.filename)))
}

/**
 * Puts the source video on disk for ffmpeg without ever holding it in memory: local
 * storage is read in place, remote storage is streamed to the job's temp directory,
 * and `fetchSource` may hand back either bytes or a path of its own.
 */
const materializeSource = async (
  payload: Payload,
  collectionSlug: string,
  doc: JsonObject,
  config: ResolvedVideoWebmConfig,
  tmpDir: string,
): Promise<string> => {
  const tempPath = path.join(tmpDir, tempInputName(String(doc.filename)))

  if (config.fetchSource) {
    const source = await config.fetchSource({ collection: collectionSlug, doc, payload })
    if (Buffer.isBuffer(source)) {
      await fs.writeFile(tempPath, source)
      return tempPath
    }
    if (source && typeof source === 'object' && typeof source.filePath === 'string') {
      return source.filePath
    }
    throw new Error(`[payload-video-webm] fetchSource must resolve to a Buffer or { filePath }`)
  }

  const local = localSourcePath(payload, collectionSlug, doc)
  if (local) {
    return local
  }

  const base = payload.config.serverURL || 'http://localhost:3000'
  const url = new URL(String(doc.url), base)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(
      `[payload-video-webm] could not fetch source "${url.href}" (HTTP ${response.status}) — set serverURL, make files readable, or provide fetchSource`,
    )
  }
  await pipeline(response.body as unknown as AsyncIterable<Uint8Array>, createWriteStream(tempPath))
  return tempPath
}

/**
 * Is this row a decision the job should honour? A row either links a rendition or
 * records why one wasn't stored. A row with neither is wreckage — Payload nulls the
 * relationship when a sidecar is deleted behind the plugin's back — and the preset
 * must be encoded again rather than counted as done.
 */
const isDecided = (row: WebmVersionRow): boolean => row.video !== null || row.skippedReason !== null

/**
 * Drops rows the plugin can no longer honour: renditions deleted behind its back
 * (whether the row still names the id or Payload already nulled it) so the job
 * encodes those presets again.
 */
const usableRows = async (
  payload: Payload,
  collectionSlug: string,
  rows: WebmVersionRow[],
): Promise<WebmVersionRow[]> => {
  const decided = rows.filter(isDecided)
  const ids = rowVideoIds(decided)
  if (ids.length === 0) {
    return decided
  }
  const found = await payload.find({
    collection: asCollectionSlug(collectionSlug),
    depth: 0,
    pagination: false,
    where: { id: { in: ids } },
  })
  const alive = new Set(found.docs.map((candidate) => relationId((candidate as JsonObject).id)))
  return decided.filter((row) => row.video === null || alive.has(row.video))
}

/**
 * The durable conversion job: encodes one sidecar rendition per configured preset.
 *
 * Idempotent and interruption-safe by design — the immediate post-upload run, a
 * retry, and the cron safety net can all pick the same row up. It bails when the
 * document is gone, when its file was replaced, or when the document's generation
 * counter has moved past the one the job was queued with (a newer upload or a
 * regenerate owns it now). Only presets without a decision are encoded, so a retry
 * after a partial failure resumes instead of duplicating, and the final write is
 * merged onto a *freshly read* document so a slow run can never resurrect
 * renditions that were retired while it worked.
 */
export const createConvertTask = (
  taskSlug: string,
  retries: number,
  registry: Map<string, ConvertTaskRegistryEntry>,
): TaskConfig => {
  // One conversion per document at a time in this process: the immediate run and a
  // cron worker picking up the same row would otherwise encode everything twice.
  const mutex = new KeyedMutex()

  const handler = (async ({
    input,
    job,
    req,
  }: {
    input: unknown
    job?: { totalTried?: number }
    req: PayloadRequest
  }) => {
    const { collection, docId, generation, sourceFilename } = input as ConvertTaskInput
    const entry = registry.get(collection)
    if (!entry) {
      return { output: {} }
    }

    return mutex.run(`${collection}:${String(docId)}`, () =>
      runConversion({
        attempt: job?.totalTried ?? 0,
        collection,
        config: entry.config,
        docId,
        generation,
        limiter: entry.limiter,
        req,
        retries,
        sourceFilename,
      }),
    )
    // Apps with generated types narrow TaskHandler to their task union, which a
    // library cannot know — hence the cast below.
  }) as unknown as TaskHandler<never>

  return {
    slug: asTaskSlug(taskSlug),
    handler,
    // Adding a field here must stay backwards compatible: durable rows queued by an
    // older deploy are still runnable after this one ships.
    inputSchema: [
      { name: 'collection', type: 'text', required: true },
      // json preserves the id's type — text would corrupt numeric ids.
      { name: 'docId', type: 'json', required: true },
      { name: 'sourceFilename', type: 'text', required: true },
      { name: 'generation', type: 'number' },
    ],
    retries,
  }
}

const runConversion = async ({
  attempt,
  collection,
  config,
  docId,
  generation,
  limiter,
  req,
  retries,
  sourceFilename,
}: {
  attempt: number
  collection: string
  config: ResolvedVideoWebmConfig
  docId: number | string
  generation: number | undefined
  limiter: null | Semaphore
  req: PayloadRequest
  retries: number
  sourceFilename: string
}): Promise<{ output: JsonObject }> => {
  const payload = req.payload

  const readDoc = async (): Promise<JsonObject | null> => {
    try {
      return (await payload.findByID({
        id: docId,
        collection: asCollectionSlug(collection),
        depth: 0,
      })) as JsonObject
    } catch {
      return null
    }
  }

  /** Has the document moved on since this job was queued? */
  const superseded = (candidate: JsonObject): boolean => {
    if (candidate.filename !== sourceFilename) {
      return true // the file was replaced — a newer job owns this document.
    }
    if (generation === undefined) {
      return false // queued before generations existed; the filename check stands alone.
    }
    return Number(candidate[WEBM_GENERATION_FIELD_NAME] ?? 0) !== generation
  }

  const doc = await readDoc()
  if (!doc) {
    // Not necessarily gone: an immediate run can reach the database before the
    // upload's transaction commits, and a rolled-back upload looks identical. Only a
    // retry can tell them apart, so keep the row runnable while attempts remain.
    if (attempt < retries) {
      throw new Error(
        `[payload-video-webm] source document ${collection}/${String(docId)} could not be read — it was deleted, its upload was rolled back, or the write it belongs to has not committed yet`,
      )
    }
    payload.logger.warn(
      `[payload-video-webm] giving up on ${collection}/${String(docId)}: the document no longer exists`,
    )
    return { output: {} }
  }
  if (superseded(doc)) {
    return { output: {} }
  }

  // Rows are the record of every decided preset — stored renditions and deliberate
  // skips alike. Renditions deleted behind the plugin's back are dropped so they get
  // encoded again.
  const startingRows = await usableRows(payload, collection, webmVersionRows(doc))
  const decided = new Set(startingRows.map((row) => row.preset))
  const pending = Object.entries(config.presets).filter(([name]) => !decided.has(name))

  const producedRows: WebmVersionRow[] = []
  const createdSidecars: (number | string)[] = []
  let totalEncodeMs = 0

  const outcomeBase = {
    collection,
    docId,
    originalFilename: String(doc.filename),
    originalFilesize: Number(doc.filesize),
    originalMimeType: String(doc.mimeType),
  }

  /** Deletes renditions this run created but never managed to link. */
  const discardCreated = async (): Promise<void> => {
    for (const id of createdSidecars) {
      await deleteSidecarDocument(req, collection, id)
    }
  }

  const presetOrder = Object.keys(config.presets)
  const orderOf = (preset: string): number => {
    const index = presetOrder.indexOf(preset)
    return index === -1 ? presetOrder.length : index
  }

  /**
   * Writes the outcome onto a freshly read document, merging this run's rows over
   * whatever the document holds now. Anything else would let a slow run overwrite a
   * newer upload's renditions with its own.
   */
  const finalize = async (outcome: {
    encodeDurationMs: null | number
    error: null | string
  }): Promise<void> => {
    const fresh = await readDoc()
    if (!fresh || superseded(fresh)) {
      payload.logger.info(
        `[payload-video-webm] discarding conversion of "${sourceFilename}" (${collection}/${String(docId)}): the document moved on while it ran`,
      )
      await discardCreated()
      return
    }

    const merged = new Map<string, WebmVersionRow>()
    // Undecided leftovers are dropped rather than carried forward, so a preset whose
    // rendition vanished is encoded again by the next run instead of looking done.
    for (const row of webmVersionRows(fresh).filter(isDecided)) {
      merged.set(row.preset, row)
    }
    for (const row of producedRows) {
      const existing = merged.get(row.preset)
      if (existing && existing.video !== null && existing.video !== row.video) {
        // A parallel run linked its own rendition for this preset while we encoded.
        // Ours replaces it in this same write, so its file must not be left behind.
        await deleteSidecarDocument(req, collection, existing.video)
      }
      merged.set(row.preset, row)
    }
    const rows = [...merged.values()].sort((a, b) => orderOf(a.preset) - orderOf(b.preset))

    const stored = rows.some((row) => row.video !== null)
    let status: ConversionStatus
    let skippedReason: null | SkipReason = null
    if (outcome.error) {
      status = 'failed'
    } else if (stored) {
      status = 'complete'
    } else {
      status = 'skipped'
      skippedReason = rows.every((row) => row.skippedReason === 'source-smaller')
        ? 'source-smaller'
        : 'output-larger'
    }

    await payload.update({
      id: docId,
      collection: asCollectionSlug(collection),
      context: { [SKIP_CONTEXT_KEY]: true },
      // Apps with generated types narrow update data per collection — unknowable here.
      data: {
        ...(config.metadataFields
          ? {
              [METADATA_GROUP_NAME]: {
                encodeDurationMs: outcome.encodeDurationMs,
                error: outcome.error ? outcome.error.slice(0, 500) : null,
                originalFilename: String(fresh.filename),
                originalFilesize: Number(fresh.filesize),
                originalMimeType: String(fresh.mimeType),
                skippedReason,
                status,
              },
            }
          : {}),
        [WEBM_VERSIONS_FIELD_NAME]: rows,
      } as never,
      depth: 0,
      overrideAccess: true,
    })
  }

  try {
    if (pending.length > 0) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payload-video-webm-job-'))
      try {
        const sourcePath = await materializeSource(payload, collection, doc, config, tmpDir)
        const sourceSize = (await fs.stat(sourcePath)).size

        // Rungs the source is too small to fill would just re-encode the same frame
        // size again; the probe is advisory, so an unreadable one encodes everything.
        const dimensions = config.skipRedundantPresets
          ? await probeVideoDimensions(config.ffmpegPath, sourcePath)
          : null
        const redundant = dimensions
          ? redundantPresets(config.presets, dimensions)
          : new Set<string>()

        // Payload stores focal points as percentages; an upload collection with
        // focalPoint disabled simply has none, which centres every crop.
        const focal = {
          x: typeof doc.focalX === 'number' ? doc.focalX : CENTRE_FOCAL_POINT.x,
          y: typeof doc.focalY === 'number' ? doc.focalY : CENTRE_FOCAL_POINT.y,
        }

        for (const [preset, resolved] of pending) {
          if (redundant.has(preset)) {
            payload.logger.info(
              `[payload-video-webm] not encoding "${preset}" for "${doc.filename}": the source is only ${dimensions?.height}px tall`,
            )
            producedRows.push({
              height: null,
              preset,
              skippedReason: 'source-smaller',
              video: null,
              width: null,
            })
            await report(config, payload.logger, {
              ...outcomeBase,
              converted: false,
              convertedFilename: null,
              convertedFilesize: null,
              encodeDurationMs: null,
              error: null,
              preset,
              skippedReason: 'source-smaller',
            })
            continue
          }

          const outputPath = path.join(tmpDir, `${preset}.webm`)
          const { encodeDurationMs } = await encodeLimited(
            { ...config, encoding: resolved.encoding },
            limiter,
            { focal, inputPath: sourcePath, outputPath },
          )
          totalEncodeMs += encodeDurationMs
          const outputSize = (await fs.stat(outputPath)).size

          if (config.skipIfLarger && outputSize >= sourceSize) {
            payload.logger.info(
              `[payload-video-webm] not storing "${preset}" for "${doc.filename}": output would be larger (${outputSize} >= ${sourceSize} bytes)`,
            )
            producedRows.push({
              height: null,
              preset,
              skippedReason: 'output-larger',
              video: null,
              width: null,
            })
            await fs.rm(outputPath, { force: true })
            await report(config, payload.logger, {
              ...outcomeBase,
              converted: false,
              convertedFilename: null,
              convertedFilesize: null,
              encodeDurationMs,
              error: null,
              preset,
              skippedReason: 'output-larger',
            })
            continue
          }

          // Measured before the file goes: selecting a rendition by how wide it is
          // shouldn't cost the frontend a second query, and Payload only derives
          // width/height for images.
          const encoded = await probeVideoDimensions(config.ffmpegPath, outputPath)

          // Payload reads uploads into memory regardless, so the bytes are only
          // loaded once the rendition is actually being kept.
          const output = await fs.readFile(outputPath)
          const sidecarId = await createSidecarDocument(payload, collection, doc, output, preset)
          createdSidecars.push(sidecarId)
          producedRows.push({
            height: encoded?.height ?? null,
            preset,
            skippedReason: null,
            video: sidecarId,
            width: encoded?.width ?? null,
          })
          await fs.rm(outputPath, { force: true })

          await report(config, payload.logger, {
            ...outcomeBase,
            converted: true,
            convertedFilename: toWebmFilename(String(doc.filename), preset),
            convertedFilesize: outputSize,
            encodeDurationMs,
            error: null,
            preset,
            skippedReason: null,
          })
        }
      } finally {
        await fs.rm(tmpDir, { force: true, recursive: true })
      }
    }

    // Runs with nothing pending still fall through to the write: it settles a
    // document left stamped `queued` by a run that was killed mid-flight.
    await finalize({ encodeDurationMs: totalEncodeMs, error: null })
    return { output: {} }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    payload.logger.warn(
      `[payload-video-webm] conversion job failed for "${sourceFilename}" (${collection}/${String(docId)}): ${message}`,
    )
    try {
      // Link whatever finished — the retry resumes the rest.
      await finalize({ encodeDurationMs: totalEncodeMs, error: message })
    } catch {
      // Recording the failure is best-effort, but renditions nothing can reach are
      // pure storage leak: drop them and let the retry encode again.
      await discardCreated()
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
}

import type { JsonObject, Payload, PayloadRequest, TaskConfig, TaskHandler } from 'payload'

import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { Semaphore } from '../core/semaphore.js'
import type { RenditionRow } from '../hooks/sidecar.js'
import type { ConversionStatus, ResolvedVideoOptimizerConfig, SkipReason } from '../types.js'

import { CENTRE_FOCAL_POINT } from '../core/args.js'
import { asCollectionSlug, asTaskSlug } from '../core/collectionSlug.js'
import { probeVideoDimensions, tempInputName } from '../core/convert.js'
import { budgetDecision, outputDimensions, redundantPresets } from '../core/defaults.js'
import { KeyedMutex } from '../core/keyedMutex.js'

/** Encode cost tracks pixel count, which is what makes projection possible at all. */
const pixelsOf = ({ height, width }: { height: number; width: number }): number => width * height
import { toWebmFilename } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import { RENDITION_GENERATION_FIELD_NAME, RENDITIONS_FIELD_NAME } from '../fields/sidecarFields.js'
import { encodeLimited, relationId, report, SKIP_CONTEXT_KEY } from '../hooks/shared.js'
import {
  createSidecarDocument,
  deleteSidecarDocument,
  renditionRows,
  rowVideoIds,
} from '../hooks/sidecar.js'

export interface ConvertTaskRegistryEntry {
  config: ResolvedVideoOptimizerConfig
  limiter: null | Semaphore
}

interface ConvertTaskInput {
  collection: string
  docId: number | string
  /** Absent on rows queued by an older version of the plugin — then unenforced. */
  generation?: number
  /** Where to send the continue request for a chunked run; absent off the web. */
  origin?: null | string
  sourceFilename: string
}

/**
 * Starts the next chunk of a run that stopped on its budget. Supplied by the plugin,
 * which owns the queue name, the task slug and the host's `dispatch`.
 */
export type ContinueChain = (args: {
  collection: string
  docId: number | string
  generation: number | undefined
  origin: null | string | undefined
  req: PayloadRequest
  sourceFilename: string
}) => Promise<void>

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
 * Reads the source through the collection's own storage adapter, in process.
 *
 * Every cloud-storage adapter (S3, Vercel Blob, Azure, GCS) registers a
 * `staticHandler` on `upload.handlers`, and it answers with the file using the
 * client the adapter already holds. That makes it strictly better than fetching the
 * document's URL: no `serverURL` to configure, no round trip out to the CDN and
 * back, and no failure when the deployment sits behind access protection — which a
 * preview deployment always does, and which no amount of correct configuration
 * would have fixed.
 *
 * Returns `null` whenever this isn't available or doesn't produce a body, so the
 * HTTP path stays as the fallback for adapters that predate the convention.
 */
const adapterSourceResponse = async (
  payload: Payload,
  collectionSlug: string,
  doc: JsonObject,
  req: PayloadRequest,
): Promise<null | Response> => {
  const upload = payload.collections[asCollectionSlug(collectionSlug)]?.config.upload
  const handlers = upload && typeof upload === 'object' ? upload.handlers : undefined
  if (!Array.isArray(handlers) || handlers.length === 0) {
    return null
  }
  const filename = String(doc.filename)
  for (const handler of handlers) {
    let response: unknown
    try {
      // The adapters read `req.headers` for range and etag negotiation; a job's req
      // may carry the headers of whatever request queued it, so pass fresh ones and
      // ask for the whole object.
      response = await handler({ ...req, headers: new Headers() } as PayloadRequest, {
        // The document itself, which adapters use to resolve a per-document prefix
        // without going back to the database.
        doc: doc as Parameters<typeof handler>[1]['doc'],
        headers: new Headers(),
        params: { collection: collectionSlug, filename },
      })
    } catch {
      continue // a handler that cannot serve this file shouldn't mask the others
    }
    if (!(response instanceof Response)) {
      continue
    }
    // `signedDownloads` makes the adapter answer with a redirect to a presigned URL
    // rather than the bytes. That URL carries its own credentials, so following it
    // needs no serverURL either.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        continue
      }
      const redirected = await fetch(location)
      if (redirected.ok && redirected.body) {
        return redirected
      }
      continue
    }
    if (response.ok && response.body) {
      return response
    }
  }
  return null
}

/**
 * Puts the source video on disk for ffmpeg without ever holding it in memory: local
 * storage is read in place, remote storage is read through the collection's storage
 * adapter (falling back to HTTP), and `fetchSource` may hand back either bytes or a
 * path of its own.
 */
const materializeSource = async (
  payload: Payload,
  collectionSlug: string,
  doc: JsonObject,
  config: ResolvedVideoOptimizerConfig,
  tmpDir: string,
  req: PayloadRequest,
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
    throw new Error(
      `[payload-video-optimizer] fetchSource must resolve to a Buffer or { filePath }`,
    )
  }

  const local = localSourcePath(payload, collectionSlug, doc)
  if (local) {
    return local
  }

  const viaAdapter = await adapterSourceResponse(payload, collectionSlug, doc, req)
  if (viaAdapter?.body) {
    await pipeline(
      viaAdapter.body as unknown as AsyncIterable<Uint8Array>,
      createWriteStream(tempPath),
    )
    return tempPath
  }

  const base = payload.config.serverURL || 'http://localhost:3000'
  const url = new URL(String(doc.url), base)
  // A refused connection rejects rather than returning a response, and undici's
  // message for that is the bare "fetch failed" — which names neither the URL nor
  // the cause. That is the likeliest failure here, not a 404: an unset serverURL
  // silently points at localhost, so a job on a remote host fetches nothing at all.
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(
      `[payload-video-optimizer] could not reach source "${url.href}" (${error instanceof Error ? error.message : String(error)})${payload.config.serverURL ? '' : ' — serverURL is not set, so this defaulted to localhost'}. Set serverURL, make files readable, or provide fetchSource.`,
    )
  }
  if (!response.ok || !response.body) {
    throw new Error(
      `[payload-video-optimizer] could not fetch source "${url.href}" (HTTP ${response.status}) — set serverURL, make files readable, or provide fetchSource`,
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
const isDecided = (row: RenditionRow): boolean => row.video !== null || row.skippedReason !== null

/**
 * Drops rows the plugin can no longer honour: renditions deleted behind its back
 * (whether the row still names the id or Payload already nulled it) so the job
 * encodes those presets again.
 */
const usableRows = async (
  payload: Payload,
  collectionSlug: string,
  rows: RenditionRow[],
): Promise<RenditionRow[]> => {
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
  continueChain: ContinueChain,
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
    const { collection, docId, generation, origin, sourceFilename } = input as ConvertTaskInput
    const entry = registry.get(collection)
    if (!entry) {
      return { output: {} }
    }

    return mutex.run(`${collection}:${String(docId)}`, () =>
      runConversion({
        attempt: job?.totalTried ?? 0,
        collection,
        config: entry.config,
        continueChain,
        docId,
        generation,
        limiter: entry.limiter,
        origin,
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
  continueChain,
  docId,
  generation,
  limiter,
  origin,
  req,
  retries,
  sourceFilename,
}: {
  attempt: number
  collection: string
  config: ResolvedVideoOptimizerConfig
  continueChain: ContinueChain
  docId: number | string
  generation: number | undefined
  limiter: null | Semaphore
  origin: null | string | undefined
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
    return Number(candidate[RENDITION_GENERATION_FIELD_NAME] ?? 0) !== generation
  }

  const doc = await readDoc()
  if (!doc) {
    // Not necessarily gone: an immediate run can reach the database before the
    // upload's transaction commits, and a rolled-back upload looks identical. Only a
    // retry can tell them apart, so keep the row runnable while attempts remain.
    if (attempt < retries) {
      throw new Error(
        `[payload-video-optimizer] source document ${collection}/${String(docId)} could not be read — it was deleted, its upload was rolled back, or the write it belongs to has not committed yet`,
      )
    }
    payload.logger.warn(
      `[payload-video-optimizer] giving up on ${collection}/${String(docId)}: the document no longer exists`,
    )
    return { output: {} }
  }
  if (superseded(doc)) {
    return { output: {} }
  }

  // Rows are the record of every decided preset — stored renditions and deliberate
  // skips alike. Renditions deleted behind the plugin's back are dropped so they get
  // encoded again.
  const startingRows = await usableRows(payload, collection, renditionRows(doc))
  const decided = new Set(startingRows.map((row) => row.preset))
  const pending = Object.entries(config.presets).filter(([name]) => !decided.has(name))

  const producedRows: RenditionRow[] = []
  const createdSidecars: (number | string)[] = []
  let totalEncodeMs = 0

  // Chunked runs: stop starting presets once the budget is spent and leave the rest
  // for a later job. `null` means no budget — one run does the whole ladder.
  const budgetMs = config.maxRunMs
  const runStartedAt = Date.now()
  const budgetLeft = (): number =>
    budgetMs === null ? Infinity : budgetMs - (Date.now() - runStartedAt)
  /**
   * Tightest of the configured per-encode cap and what the run may still spend.
   * `null` on either side means unbounded, so it never wins.
   */
  const capTimeout = (configured: null | number, budget: number): null | number => {
    const tightest = Math.min(configured ?? Infinity, budget)
    return Number.isFinite(tightest) ? tightest : null
  }
  /** Measured cost per output pixel, from whichever presets this run has finished. */
  let msPerPixel: null | number = null

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
    /** Presets this run left undecided — a later chunk will encode them. */
    pendingRemain?: boolean
  }): Promise<void> => {
    const fresh = await readDoc()
    if (!fresh || superseded(fresh)) {
      payload.logger.info(
        `[payload-video-optimizer] discarding conversion of "${sourceFilename}" (${collection}/${String(docId)}): the document moved on while it ran`,
      )
      await discardCreated()
      return
    }

    const merged = new Map<string, RenditionRow>()
    // Undecided leftovers are dropped rather than carried forward, so a preset whose
    // rendition vanished is encoded again by the next run instead of looking done.
    for (const row of renditionRows(fresh).filter(isDecided)) {
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
    } else if (outcome.pendingRemain) {
      // A chunked run that stopped on its budget is not finished, however much it
      // stored — saying `complete` here would stop the panel polling mid-ladder.
      status = 'queued'
    } else if (stored) {
      status = 'complete'
    } else {
      status = 'skipped'
      // One reason for the whole document only when the rows agree; a mixed set has
      // no single answer, and reporting the first-listed would be arbitrary.
      const reasons = new Set(rows.map((row) => row.skippedReason))
      skippedReason =
        reasons.size === 1 ? ((rows[0]?.skippedReason ?? null) as SkipReason) : 'output-larger'
    }

    // Conditional, not by id: `superseded` was checked against a read that happened
    // before the encode's final I/O, and a re-upload landing in that window would
    // otherwise let this run attach an old file's rendition to the new one — the
    // next job would then see a matching generation and a live sidecar, call the
    // preset decided, and never re-encode it.
    const written = await payload.update({
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
        [RENDITIONS_FIELD_NAME]: rows,
      } as never,
      depth: 0,
      overrideAccess: true,
      where: {
        and: [
          { id: { equals: docId } },
          { filename: { equals: sourceFilename } },
          // Rows queued before this field existed carry no generation to compare.
          ...(generation === undefined
            ? []
            : [{ [RENDITION_GENERATION_FIELD_NAME]: { equals: generation } }]),
        ],
      },
    })

    if (written.docs.length === 0) {
      payload.logger.info(
        `[payload-video-optimizer] discarding conversion of "${sourceFilename}" (${collection}/${String(docId)}): the document changed while the result was being written`,
      )
      await discardCreated()
    }
  }

  try {
    if (pending.length > 0) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payload-video-optimizer-job-'))
      try {
        const sourcePath = await materializeSource(payload, collection, doc, config, tmpDir, req)
        const sourceSize = (await fs.stat(sourcePath)).size

        // Rungs the source is too small to fill would just re-encode the same frame
        // size again; the probe is advisory, so an unreadable one encodes everything.
        // Needed by two things now: the redundancy check, and the chunked-run cost
        // projection. Without it a budgeted run can't tell a rung that won't fit from
        // one that will, and starts encodes it has no time for.
        const dimensions =
          config.skipRedundantPresets || budgetMs !== null
            ? await probeVideoDimensions(config.ffmpegPath, sourcePath)
            : null
        const redundant =
          dimensions && config.skipRedundantPresets
            ? redundantPresets(config.presets, dimensions)
            : new Map<string, SkipReason>()

        // Payload stores focal points as percentages; an upload collection with
        // focalPoint disabled simply has none, which centres every crop.
        const focal = {
          x: typeof doc.focalX === 'number' ? doc.focalX : CENTRE_FOCAL_POINT.x,
          y: typeof doc.focalY === 'number' ? doc.focalY : CENTRE_FOCAL_POINT.y,
        }

        // Two orders, for two different failures.
        //
        // Budgeted: cheapest rung first, so a run that cannot afford the whole ladder
        // still banks the small rungs before it hits one it must skip or defer. Since
        // everything after a skip is larger, the skip cascades correctly and the
        // document degrades a rung at a time rather than all at once.
        //
        // Unbudgeted: declaration order, which is widest first. Nothing here can
        // predict a kill, and partial progress only survives a *clean* failure (the
        // catch below links whatever finished), so the run should hold the rendition
        // that matters most if it gets that far.
        //
        // Both need `dimensions`: an unreadable probe means no cost projection, so
        // there is nothing to sort by.
        const order =
          budgetMs !== null && dimensions
            ? [...pending].sort(
                ([, a], [, b]) =>
                  pixelsOf(outputDimensions(a, dimensions)) -
                  pixelsOf(outputDimensions(b, dimensions)),
              )
            : pending

        for (const [preset, resolved] of order) {
          const redundantReason = redundant.get(preset)
          if (redundantReason) {
            payload.logger.info(
              redundantReason === 'duplicate-size'
                ? `[payload-video-optimizer] not encoding "${preset}" for "${doc.filename}": another preset produces the same frame size`
                : `[payload-video-optimizer] not encoding "${preset}" for "${doc.filename}": the source is only ${dimensions?.height}px tall`,
            )
            producedRows.push({
              height: null,
              preset,
              skippedReason: redundantReason,
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
              skippedReason: redundantReason,
            })
            continue
          }

          const outputPixels = dimensions ? pixelsOf(outputDimensions(resolved, dimensions)) : null
          const projectedMs =
            msPerPixel !== null && outputPixels !== null ? msPerPixel * outputPixels : null

          const forced = producedRows.length === 0
          const decision = budgetDecision({
            budgetLeftMs: budgetLeft(),
            budgetMs,
            forced,
            projectedMs,
          })

          if (decision === 'skip') {
            payload.logger.warn(
              `[payload-video-optimizer] not encoding "${preset}" for "${doc.filename}": it needs about ${Math.round((projectedMs ?? 0) / 1000)}s but jobs.maxRunMs is ${budgetMs}ms. Raise the budget, drop the rung, or run the queue on a worker.`,
            )
            producedRows.push({
              height: null,
              preset,
              skippedReason: 'exceeds-budget',
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
              skippedReason: 'exceeds-budget',
            })
            continue
          }
          if (decision === 'defer') {
            break // a later chunk picks this up with a full budget
          }

          const outputPath = path.join(tmpDir, `${preset}.webm`)
          const { encodeDurationMs } = await encodeLimited(
            // Cap the encode at what's left: being killed by us fails cleanly and
            // retries, being killed by the platform leaves the job row claimed.
            {
              ...config,
              encoding: resolved.encoding,
              // A forced encode gets the *whole* budget rather than what's left,
              // since the budget may already be spent — but it is still clamped, or
              // the split fails to prevent the platform kill it exists to prevent
              // (msPerPixel is per-run, so every chunk has a forced first encode).
              //
              // Both terms can be Infinity — an unbudgeted run on a host with no
              // execution limit — and Math.min keeps that, which is the point: the
              // encode is bounded by whichever real limit exists, or by none.
              timeoutMs: capTimeout(
                config.timeoutMs,
                forced ? (budgetMs ?? Infinity) : budgetLeft(),
              ),
            },
            limiter,
            { focal, inputPath: sourcePath, outputPath },
          )
          totalEncodeMs += encodeDurationMs
          if (outputPixels) {
            msPerPixel = encodeDurationMs / outputPixels
          }
          const outputSize = (await fs.stat(outputPath)).size

          if (config.skipIfLarger && outputSize >= sourceSize) {
            payload.logger.info(
              `[payload-video-optimizer] not storing "${preset}" for "${doc.filename}": output would be larger (${outputSize} >= ${sourceSize} bytes)`,
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
    const decidedNow = new Set(producedRows.map((row) => row.preset))
    const pendingRemain = pending.some(([name]) => !decidedNow.has(name))
    await finalize({ encodeDurationMs: totalEncodeMs, error: null, pendingRemain })

    if (pendingRemain) {
      // Best-effort: a lost continue leaves a runnable row, which cron settles. The
      // chain is a latency optimisation over that, never a replacement for it.
      await continueChain({ collection, docId, generation, origin, req, sourceFilename })
    }
    return { output: {} }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    payload.logger.warn(
      `[payload-video-optimizer] conversion job failed for "${sourceFilename}" (${collection}/${String(docId)}): ${message}`,
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

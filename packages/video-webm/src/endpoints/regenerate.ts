import type { Endpoint, JsonObject } from 'payload'

import type { QueueHookOptions } from '../hooks/stampAndQueue.js'
import type { ConvertTaskRegistryEntry } from '../jobs/convertTask.js'

import { asCollectionSlug } from '../core/collectionSlug.js'
import { shouldConvert as passesStaticGuards } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import { WEBM_GENERATION_FIELD_NAME, WEBM_VERSIONS_FIELD_NAME } from '../fields/sidecarFields.js'
import { GC_CONTEXT_KEY } from '../hooks/shared.js'
import { queueConversionJob } from '../hooks/stampAndQueue.js'
import { webmVersionRows } from '../hooks/webmSidecar.js'

const json = (status: number, body: JsonObject): Response => Response.json(body, { status })

/**
 * How long a queued conversion is treated as still in flight. Short enough that a
 * run killed mid-encode can be retried from the admin panel without waiting out a
 * long encode, long enough that a double-click (or a script) can't spend the
 * server's cores on the same document over and over.
 */
const QUEUE_COOLDOWN_MS = 30_000

/**
 * `POST /<taskSlug>/regenerate` `{ collection, id, preset? }` — drops the named
 * rendition (or all of them) and re-queues the conversion job, so the file is
 * re-encoded with the *current* plugin config. The stale sidecar documents are
 * garbage-collected by the cleanup hook when their rows disappear, and the job's
 * per-preset idempotency re-encodes exactly what's missing.
 *
 * Gated by the collection's own `update` access control, evaluated for the
 * requesting user, and rate-limited to one queued conversion per document.
 */
export const createRegenerateEndpoint = (
  { dispatch, queue, taskSlug }: QueueHookOptions,
  registry: Map<string, ConvertTaskRegistryEntry>,
): Endpoint => ({
  handler: async (req) => {
    let body: JsonObject
    try {
      body = ((await req.json?.()) ?? {}) as JsonObject
    } catch {
      return json(400, { error: 'invalid JSON body' })
    }
    const collection = body.collection
    const id = body.id
    const preset = body.preset
    if (typeof collection !== 'string' || (typeof id !== 'string' && typeof id !== 'number')) {
      return json(400, { error: '`collection` and `id` are required' })
    }
    if (preset !== undefined && typeof preset !== 'string') {
      return json(400, { error: '`preset` must be a string when given' })
    }

    const entry = registry.get(collection)
    const collectionConfig = req.payload.collections[asCollectionSlug(collection)]?.config
    if (!entry || !collectionConfig) {
      return json(404, { error: `collection "${collection}" is not targeted by the plugin` })
    }
    if (preset && !(preset in entry.config.presets)) {
      return json(400, { error: `unknown preset "${preset}"` })
    }

    // Read before the access gate so the gate sees the real patch, but answer 403
    // before 404: whether a document exists is not for unauthorized callers to learn.
    let doc: JsonObject | null = null
    try {
      doc = (await req.payload.findByID({
        id,
        collection: asCollectionSlug(collection),
        depth: 0,
        overrideAccess: true,
      })) as JsonObject
    } catch {
      doc = null
    }

    // Drop the targeted rows; the afterChange cleanup hook garbage-collects the
    // now-unreferenced sidecar documents, and the job re-encodes what's missing.
    const keptRows =
      doc && preset ? webmVersionRows(doc).filter((row) => row.preset !== preset) : []
    const generation = Number(doc?.[WEBM_GENERATION_FIELD_NAME] ?? 0) + 1
    const data: JsonObject = doc
      ? {
          ...(entry.config.metadataFields
            ? {
                [METADATA_GROUP_NAME]: {
                  encodeDurationMs: null,
                  error: null,
                  originalFilename: doc.filename,
                  originalFilesize: doc.filesize,
                  originalMimeType: doc.mimeType,
                  skippedReason: null,
                  status: 'queued',
                },
              }
            : {}),
          [WEBM_GENERATION_FIELD_NAME]: generation,
          [WEBM_VERSIONS_FIELD_NAME]: keptRows,
        }
      : {}

    // The collection's own update access decides who may regenerate — evaluated
    // against the patch this endpoint actually writes, so access functions that
    // branch on `data` see what a real update would give them.
    const updateAccess = collectionConfig.access?.update
    if (updateAccess) {
      // Apps with generated types narrow the access args' id — unknowable here.
      const result = await updateAccess({ id: id as never, data, req })
      if (result !== true) {
        if (!result) {
          return json(403, { error: 'forbidden' })
        }
        // Where-clause access — allowed only if this document matches it.
        const match = await req.payload.find({
          collection: asCollectionSlug(collection),
          depth: 0,
          limit: 1,
          overrideAccess: true,
          where: { and: [{ id: { equals: id } }, result] },
        })
        if (match.totalDocs === 0) {
          return json(403, { error: 'forbidden' })
        }
      }
    } else if (!req.user) {
      return json(403, { error: 'forbidden' })
    }

    if (!doc) {
      return json(404, { error: 'document not found' })
    }

    const guard = passesStaticGuards(
      { mimetype: String(doc.mimeType), size: Number(doc.filesize) },
      entry.config,
    )
    if (!guard.convert) {
      return json(400, { error: `document is not a convertible video (${guard.reason})` })
    }

    // Encodes are expensive: refuse to pile another one onto a document whose
    // conversion is still in flight. Past the cooldown a repeat is allowed on
    // purpose — it is the way out of a job that was killed mid-encode, and the
    // generation bump makes the abandoned run discard its work.
    const record = doc[METADATA_GROUP_NAME] as JsonObject | undefined
    const updatedAt = Date.parse(String(doc.updatedAt))
    if (
      record?.status === 'queued' &&
      Number.isFinite(updatedAt) &&
      Date.now() - updatedAt < QUEUE_COOLDOWN_MS
    ) {
      return json(409, { error: 'a conversion for this document is already queued' })
    }

    await req.payload.update({
      id,
      collection: asCollectionSlug(collection),
      // Retiring these renditions is the point of the request, so the cleanup hook
      // is explicitly allowed to delete the files they pointed at.
      context: { [GC_CONTEXT_KEY]: true },
      // Apps with generated types narrow update data per collection — unknowable here.
      data: data as never,
      depth: 0,
      overrideAccess: true,
    })

    await queueConversionJob({
      collection,
      dispatch,
      docId: id,
      generation,
      queue,
      req,
      sourceFilename: String(doc.filename),
      taskSlug,
    })

    return json(202, { queued: true })
  },
  method: 'post',
  path: `/${taskSlug}/regenerate`,
})

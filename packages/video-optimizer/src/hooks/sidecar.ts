import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  JsonObject,
  Payload,
  PayloadRequest,
} from 'payload'

import { asCollectionSlug } from '../core/collectionSlug.js'
import { toWebmFilename } from '../core/shouldConvert.js'
import { METADATA_GROUP_NAME } from '../fields/conversionMetadataField.js'
import {
  RENDITION_GENERATION_FIELD_NAME,
  RENDITION_PRESET_FIELD_NAME,
  RENDITIONS_FIELD_NAME,
  VIDEO_DERIVATIVE_FLAG_FIELD_NAME,
} from '../fields/sidecarFields.js'
import { GC_CONTEXT_KEY, relationId, SKIP_CONTEXT_KEY, withSkipContext } from './shared.js'

/** Payload's document-level upload keys — never copied onto a sidecar document. */
const NON_COPYABLE_KEYS = new Set([
  'createdAt',
  'filename',
  'filesize',
  'focalX',
  'focalY',
  'height',
  'id',
  METADATA_GROUP_NAME,
  'mimeType',
  RENDITION_GENERATION_FIELD_NAME,
  RENDITION_PRESET_FIELD_NAME,
  RENDITIONS_FIELD_NAME,
  'sizes',
  'thumbnailURL',
  'updatedAt',
  'url',
  VIDEO_DERIVATIVE_FLAG_FIELD_NAME,
  'width',
])

/**
 * One `renditions` row, tolerating populated or id-only relationship values. A
 * `null` video means the preset was deliberately not stored — `skippedReason` says
 * why — which is a decision, not a gap: later runs must not re-encode it.
 */
export interface RenditionRow {
  /** Encoded dimensions, measured off the file; `null` when the probe couldn't read them. */
  height: null | number
  preset: string
  skippedReason: null | string
  video: null | number | string
  width: null | number
}

/** Normalizes a document's `renditions` into rows with plain ids. */
export const renditionRows = (doc: JsonObject | undefined): RenditionRow[] => {
  const raw = doc?.[RENDITIONS_FIELD_NAME]
  if (!Array.isArray(raw)) {
    return []
  }
  const rows: RenditionRow[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const preset = (row as JsonObject).preset
    if (typeof preset !== 'string') {
      continue
    }
    const skippedReason = (row as JsonObject).skippedReason
    const width = (row as JsonObject).width
    const height = (row as JsonObject).height
    rows.push({
      height: typeof height === 'number' ? height : null,
      preset,
      skippedReason: typeof skippedReason === 'string' ? skippedReason : null,
      video: relationId((row as JsonObject).video),
      width: typeof width === 'number' ? width : null,
    })
  }
  return rows
}

/** The sidecar ids a document currently links — skipped rows contribute nothing. */
export const rowVideoIds = (rows: RenditionRow[]): (number | string)[] =>
  rows.flatMap((row) => (row.video === null ? [] : [row.video]))

/**
 * Stores one encoded rendition as a hidden second document in the same collection —
 * which is what keeps the plugin storage-agnostic: the sidecar flows through the
 * exact storage adapter (S3, Blob, local) the collection already uses. The source
 * document's user fields are copied so required fields validate on the sidecar.
 */
export const createSidecarDocument = async (
  payload: Payload,
  collectionSlug: string,
  sourceDoc: JsonObject,
  webm: Buffer,
  preset: string,
): Promise<number | string> => {
  const copied: JsonObject = {}
  for (const [key, value] of Object.entries(sourceDoc)) {
    if (!NON_COPYABLE_KEYS.has(key)) {
      copied[key] = value
    }
  }

  const sidecar = await payload.create({
    collection: asCollectionSlug(collectionSlug),
    context: { [SKIP_CONTEXT_KEY]: true },
    data: {
      ...copied,
      [RENDITION_PRESET_FIELD_NAME]: preset,
      [VIDEO_DERIVATIVE_FLAG_FIELD_NAME]: true,
    },
    file: {
      name: toWebmFilename(String(sourceDoc.filename), preset),
      data: webm,
      mimetype: 'video/webm',
      size: webm.byteLength,
    },
    overrideAccess: true,
  })

  const id = relationId(sidecar.id)
  if (id === null) {
    throw new Error(`[payload-video-optimizer] sidecar create returned no usable id`)
  }
  return id
}

/**
 * Deletes one rendition, joining the caller's transaction so a rolled-back update
 * doesn't take real files with it while restoring the rows that referenced them.
 */
export const deleteSidecarDocument = async (
  req: PayloadRequest,
  collectionSlug: string,
  id: number | string,
): Promise<void> => {
  try {
    await withSkipContext(req, () =>
      req.payload.delete({
        id,
        collection: asCollectionSlug(collectionSlug),
        overrideAccess: true,
        req,
      }),
    )
  } catch (error) {
    // An orphaned sidecar is preferable to failing the user's operation.
    req.payload.logger.warn(
      `[payload-video-optimizer] failed to delete stale WebM sidecar ${id} in "${collectionSlug}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Removes sidecar documents that dropped out of `renditions` on an update —
 * after the write, so a failed update never orphans still-referenced renditions.
 * This also fires on the job's own link update, garbage-collecting the previous
 * file's renditions after a re-encode.
 *
 * Only writes that genuinely retire renditions may collect: a new file (`req.file`),
 * the plugin's own job update, or the regenerate endpoint. Any other write — a plain
 * save, a restored version, a document duplicated from one that had renditions —
 * carries an older snapshot of `renditions` through no fault of the renditions,
 * and deleting live files on the strength of it would be data loss.
 */
export const createSidecarCleanupHook =
  (): CollectionAfterChangeHook =>
  async ({ collection, doc, previousDoc, req }) => {
    const retires =
      Boolean(req.file) || req.context[SKIP_CONTEXT_KEY] || req.context[GC_CONTEXT_KEY]
    if (!retires) {
      return doc
    }
    const current = new Set(rowVideoIds(renditionRows(doc as JsonObject)))
    for (const id of rowVideoIds(renditionRows(previousDoc as JsonObject | undefined))) {
      if (!current.has(id)) {
        await deleteSidecarDocument(req, collection.slug, id)
      }
    }
    return doc
  }

/** Deleting an original also deletes its renditions; sidecars carry no links themselves, so this never recurses. */
export const createSidecarDeleteHook =
  (): CollectionAfterDeleteHook =>
  async ({ collection, doc, req }) => {
    if (req.context[SKIP_CONTEXT_KEY]) {
      return doc
    }
    for (const id of rowVideoIds(renditionRows(doc as JsonObject))) {
      await deleteSidecarDocument(req, collection.slug, id)
    }
    return doc
  }

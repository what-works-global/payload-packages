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
  WEBM_DERIVATIVE_FLAG_FIELD_NAME,
  WEBM_PRESET_FIELD_NAME,
  WEBM_VERSIONS_FIELD_NAME,
} from '../fields/sidecarFields.js'
import { relationId, SKIP_CONTEXT_KEY } from './shared.js'

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
  'sizes',
  'thumbnailURL',
  'updatedAt',
  'url',
  WEBM_DERIVATIVE_FLAG_FIELD_NAME,
  WEBM_PRESET_FIELD_NAME,
  WEBM_VERSIONS_FIELD_NAME,
  'width',
])

/** One `webmVersions` row, tolerating populated or id-only relationship values. */
export interface WebmVersionRow {
  preset: string
  video: number | string
}

/** Normalizes a document's `webmVersions` into rows with plain ids. */
export const webmVersionRows = (doc: JsonObject | undefined): WebmVersionRow[] => {
  const raw = doc?.[WEBM_VERSIONS_FIELD_NAME]
  if (!Array.isArray(raw)) {
    return []
  }
  const rows: WebmVersionRow[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const preset = (row as JsonObject).preset
    const video = relationId((row as JsonObject).video)
    if (typeof preset === 'string' && video !== null) {
      rows.push({ preset, video })
    }
  }
  return rows
}

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
      [WEBM_DERIVATIVE_FLAG_FIELD_NAME]: true,
      [WEBM_PRESET_FIELD_NAME]: preset,
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
    throw new Error(`[payload-video-webm] sidecar create returned no usable id`)
  }
  return id
}

export const deleteSidecarDocument = async (
  req: PayloadRequest,
  collectionSlug: string,
  id: number | string,
): Promise<void> => {
  try {
    await req.payload.delete({
      id,
      collection: asCollectionSlug(collectionSlug),
      context: { [SKIP_CONTEXT_KEY]: true },
      overrideAccess: true,
    })
  } catch (error) {
    // An orphaned sidecar is preferable to failing the user's operation.
    req.payload.logger.warn(
      `[payload-video-webm] failed to delete stale WebM sidecar ${id} in "${collectionSlug}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Removes sidecar documents that dropped out of `webmVersions` on an update —
 * after the write, so a failed update never orphans still-referenced renditions.
 * This also fires on the job's own link update, garbage-collecting the previous
 * file's renditions after a re-encode.
 */
export const createSidecarCleanupHook =
  (): CollectionAfterChangeHook =>
  async ({ collection, doc, previousDoc, req }) => {
    const current = new Set(webmVersionRows(doc as JsonObject).map((row) => row.video))
    for (const row of webmVersionRows(previousDoc as JsonObject | undefined)) {
      if (!current.has(row.video)) {
        await deleteSidecarDocument(req, collection.slug, row.video)
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
    for (const row of webmVersionRows(doc as JsonObject)) {
      await deleteSidecarDocument(req, collection.slug, row.video)
    }
    return doc
  }

import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeChangeHook,
  JsonObject,
  PayloadRequest,
} from 'payload'

import { APIError } from 'payload'

import type { Semaphore } from '../core/semaphore.js'
import type { ConversionRecord, ResolvedVideoWebmConfig } from '../types.js'

import { asCollectionSlug } from '../core/collectionSlug.js'
import { toWebmFilename } from '../core/shouldConvert.js'
import {
  attemptConversion,
  convertedOutcome,
  emptyRecord,
  report,
  SKIP_CONTEXT_KEY,
  skipRecord,
} from './attemptConversion.js'
import { METADATA_GROUP_NAME } from './stampConversionMetadata.js'

/** Relationship on the original document pointing at its WebM sidecar document. */
export const WEBM_VERSION_FIELD_NAME = 'webmVersion'

/** Hidden flag marking a document as a plugin-managed WebM sidecar. */
export const WEBM_DERIVATIVE_FLAG_FIELD_NAME = 'isWebmDerivative'

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
  WEBM_VERSION_FIELD_NAME,
  'width',
])

/** A relationship value may arrive as an id or a populated document. */
const relationId = (value: unknown): null | number | string => {
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

const deleteDerivative = async (
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
    // An orphaned derivative is preferable to failing the user's operation.
    req.payload.logger.warn(
      `[payload-video-webm] failed to delete stale WebM derivative ${id} in "${collectionSlug}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * keepOriginal mode: the uploaded file is stored untouched as the document's own
 * asset; the WebM lands as a second, hidden document in the same collection (so it
 * flows through the same storage adapter, S3 included) and is linked from the
 * original via `webmVersion`. Runs in `beforeChange`, before the database write, so
 * a failed conversion with `onError: 'throw'` still rejects the whole upload.
 */
export const createSidecarHook = (
  config: ResolvedVideoWebmConfig,
  limiter: null | Semaphore,
): CollectionBeforeChangeHook => {
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
    const result = await attemptConversion({ collectionSlug, config, file, limiter, req })

    let record: ConversionRecord = result.record ?? emptyRecord
    let webmVersionId: null | number | string = null

    if (result.converted) {
      // Copy the incoming user fields so required fields on the collection also
      // validate on the sidecar; upload-derived and plugin-owned keys stay off it.
      const copied: JsonObject = {}
      for (const [key, value] of Object.entries(data ?? {})) {
        if (!NON_COPYABLE_KEYS.has(key)) {
          copied[key] = value
        }
      }

      try {
        const derivative = await req.payload.create({
          collection: asCollectionSlug(collectionSlug),
          context: { [SKIP_CONTEXT_KEY]: true },
          data: { ...copied, [WEBM_DERIVATIVE_FLAG_FIELD_NAME]: true },
          file: {
            name: toWebmFilename(file.name),
            data: result.output,
            mimetype: 'video/webm',
            size: result.output.byteLength,
          },
          overrideAccess: true,
        })
        webmVersionId = relationId(derivative.id)
        await report(
          config,
          req,
          convertedOutcome(
            collectionSlug,
            result.sourceFile,
            result.output,
            result.encodeDurationMs,
          ),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (config.onError === 'skip') {
          req.payload.logger.warn(
            `[payload-video-webm] storing "${file.name}" without a WebM sidecar, creating it failed: ${message}`,
          )
          record = skipRecord('derivative-failed')
          await report(config, req, {
            ...convertedOutcome(
              collectionSlug,
              result.sourceFile,
              result.output,
              result.encodeDurationMs,
            ),
            converted: false,
            convertedFilename: null,
            convertedFilesize: null,
            skippedReason: 'derivative-failed',
          })
        } else {
          throw new APIError(
            `[payload-video-webm] failed to store WebM sidecar for "${file.name}": ${message}`,
            500,
          )
        }
      }
    }

    // Always reset both plugin fields when a file arrives: a replaced upload must
    // never keep pointing at the previous file's derivative or metadata. The stale
    // derivative document itself is removed by the afterChange cleanup hook.
    return {
      ...data,
      ...(config.metadataFields ? { [METADATA_GROUP_NAME]: record } : {}),
      [WEBM_VERSION_FIELD_NAME]: webmVersionId,
    }
  }
}

/**
 * Removes the previous sidecar document once an update replaced (or cleared) the
 * `webmVersion` link — after the write, so a failed update never orphans the doc's
 * still-referenced derivative.
 */
export const createSidecarCleanupHook =
  (): CollectionAfterChangeHook =>
  async ({ collection, doc, previousDoc, req }) => {
    const previous = relationId((previousDoc as JsonObject | undefined)?.[WEBM_VERSION_FIELD_NAME])
    const current = relationId((doc as JsonObject)?.[WEBM_VERSION_FIELD_NAME])
    if (previous !== null && previous !== current) {
      await deleteDerivative(req, collection.slug, previous)
    }
    return doc
  }

/** Deleting an original also deletes its sidecar; sidecars themselves have no link, so this never recurses. */
export const createSidecarDeleteHook =
  (): CollectionAfterDeleteHook =>
  async ({ collection, doc, req }) => {
    if (req.context[SKIP_CONTEXT_KEY]) {
      return doc
    }
    const id = relationId((doc as JsonObject)?.[WEBM_VERSION_FIELD_NAME])
    if (id !== null) {
      await deleteDerivative(req, collection.slug, id)
    }
    return doc
  }

import type { Payload } from 'payload'

import type { DevelopmentFileStorageArgs, Env } from '../../types.js'

const FILENAME_FIELD = 'filename'

interface MongoIndexDescriptor {
  key?: Record<string, number>
  name?: string
  unique?: boolean
}

interface NativeCollectionLike {
  dropIndex: (indexName: string) => Promise<unknown>
  indexes: () => Promise<MongoIndexDescriptor[]>
}

interface MongooseModelLike {
  collection?: NativeCollectionLike
  init: () => Promise<unknown>
}

interface MongooseDbLike {
  collections?: Record<string, MongooseModelLike>
  connection?: unknown
  name?: string
}

const isSingleFieldFilenameUniqueIndex = (index: MongoIndexDescriptor): boolean => {
  const keys = Object.keys(index.key || {})
  return index.unique === true && keys.length === 1 && keys[0] === FILENAME_FIELD
}

const isCompoundFilenameUniqueIndex = (index: MongoIndexDescriptor): boolean => {
  const keys = Object.keys(index.key || {})
  return index.unique === true && keys.length > 1 && keys.includes(FILENAME_FIELD)
}

/**
 * When this plugin scopes upload filename uniqueness to the storage prefix it sets
 * `upload.filenameCompoundIndex = ['filename', 'prefix']`, and payload then builds a
 * compound `{ filename: 1, prefix: 1 }` unique index *instead of* the single-field
 * `{ filename: 1 }` unique index. A database first indexed before that change — under
 * an older release of this plugin, or while filename was still globally unique — keeps
 * the orphaned `filename_1` index, because mongoose's `autoIndex` only *creates*
 * missing indexes and never drops ones that have left the schema. That leftover global
 * index then rejects same-filename/different-prefix documents (including production
 * documents copied into development under their original prefix) with a duplicate-key
 * error surfaced as `ValidationError: filename`.
 *
 * Drop the superseded single-field index so only the compound index enforces
 * uniqueness. Guards keep this safe:
 * - development env only — never touches the production database, where the single-field
 *   unique index is legitimate (and where this plugin is typically disabled);
 * - cloud-storage mode only — the only mode that sets `filenameCompoundIndex`;
 * - mongoose only — drizzle adapters reconcile indexes when their schema is pushed;
 * - the compound replacement must already exist before the old index is dropped, so the
 *   collection is never left without any filename uniqueness.
 *
 * Best-effort: any failure is logged and swallowed so it can never take down boot or a
 * runtime environment switch.
 */
export const dropSupersededFilenameIndexes = async ({
  developmentFileStorage,
  env,
  payload,
}: {
  developmentFileStorage: DevelopmentFileStorageArgs
  env: Env
  payload: Payload
}): Promise<void> => {
  if (env !== 'development' || developmentFileStorage.mode !== 'cloud-storage') {
    return
  }

  const db = payload.db as unknown as MongooseDbLike
  if (db.name !== 'mongoose' || !db.connection || !db.collections) {
    return
  }

  for (const collection of payload.config.collections) {
    const upload = collection.upload
    if (!upload || typeof upload !== 'object') {
      continue
    }

    const filenameCompoundIndex = (upload as { filenameCompoundIndex?: unknown })
      .filenameCompoundIndex
    if (!Array.isArray(filenameCompoundIndex) || !filenameCompoundIndex.includes(FILENAME_FIELD)) {
      continue
    }

    const model = db.collections[collection.slug]
    const nativeCollection = model?.collection
    if (!model || !nativeCollection) {
      continue
    }

    try {
      // Wait for autoIndex to finish building the schema's indexes (including the
      // compound replacement) before deciding what can be safely dropped.
      await model.init()

      const indexes = await nativeCollection.indexes()
      const compoundIndex = indexes.find(isCompoundFilenameUniqueIndex)
      const singleFieldIndex = indexes.find(isSingleFieldFilenameUniqueIndex)

      if (!compoundIndex || !singleFieldIndex?.name) {
        continue
      }

      await nativeCollection.dropIndex(singleFieldIndex.name)
      payload.logger.info(
        `[payload-plugin-switch-env] Dropped superseded unique index "${singleFieldIndex.name}" on "${collection.slug}" — filename uniqueness is now scoped to the storage prefix.`,
      )
    } catch (error) {
      payload.logger.warn(
        `[payload-plugin-switch-env] Could not drop the superseded single-field filename unique index on "${collection.slug}": ${
          error instanceof Error ? error.message : String(error)
        }. If uploads fail with "ValidationError: filename", drop the unique { filename: 1 } index manually.`,
      )
    }
  }
}

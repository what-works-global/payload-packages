import type { Payload } from 'payload'

import type { DevelopmentFileStorageArgs, Env } from '../../types.js'

const FILENAME_FIELD = 'filename'

interface MongoIndexDescriptor {
  key?: Record<string, number>
  name?: string
  unique?: boolean
}

interface NativeCollectionLike {
  createIndex: (
    keys: Record<string, number>,
    options?: { name?: string; unique?: boolean },
  ) => Promise<unknown>
  dropIndex: (indexName: string) => Promise<unknown>
  indexes: () => Promise<MongoIndexDescriptor[]>
}

interface MongooseModelLike {
  collection?: NativeCollectionLike
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

// Mongo reports a not-yet-created collection as NamespaceNotFound (code 26). On a
// fresh database the upload collection is created lazily on first write, so this
// just means there is nothing to heal — not an error worth warning about.
const isNamespaceNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }
  if ((error as { code?: unknown }).code === 26) {
    return true
  }
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ns does not exist')
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
 * - the compound replacement is ensured (created if missing) before the old index is
 *   dropped, so the collection is never left without any filename uniqueness.
 *
 * Deliberately does NOT go through `model.init()`/`ensureIndexes()`: while the stale
 * index exists, autoIndex can't build the schema's *non-unique* `filename` index (same
 * name as the stale unique one), so `init()` rejects before we could act. We work the
 * native collection directly instead. After the drop the name is free, and the next
 * connect's autoIndex recreates the non-unique perf index cleanly.
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

    const nativeCollection = db.collections[collection.slug]?.collection
    if (!nativeCollection) {
      continue
    }

    try {
      let indexes: MongoIndexDescriptor[]
      try {
        indexes = await nativeCollection.indexes()
      } catch (error) {
        if (isNamespaceNotFoundError(error)) {
          // Collection not created yet (fresh database) — nothing to heal.
          continue
        }
        throw error
      }

      const singleFieldIndex = indexes.find(isSingleFieldFilenameUniqueIndex)
      if (!singleFieldIndex?.name) {
        // No orphaned single-field unique index — nothing to heal.
        continue
      }

      // Ensure the compound replacement exists before removing the old uniqueness,
      // so the collection is never left without a unique constraint. autoIndex
      // builds it from the same config on connect, but it isn't awaited — and we
      // can't wait on it (see the note above) — so (re)create it idempotently from
      // the configured fields. An identical spec is a no-op if it already exists.
      if (!indexes.some(isCompoundFilenameUniqueIndex)) {
        const compoundKey: Record<string, number> = {}
        for (const field of filenameCompoundIndex) {
          if (typeof field === 'string') {
            compoundKey[field] = 1
          }
        }
        await nativeCollection.createIndex(compoundKey, { unique: true })
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

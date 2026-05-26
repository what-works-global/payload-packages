import type { Connection, mongo } from 'mongoose'
import type { BasePayload } from 'payload'

import type { CollectionCopyScope, VersionCollectionModes } from '../copyUtils.js'

type MongoDoc = mongo.Document
type MongoCollection = mongo.Collection<MongoDoc>

const topNSupportByDbObjectKey = new WeakMap<object, boolean>()
const topNSupportByDbStringKey = new Map<string, boolean>()

export interface BackupData {
  collections: { [collectionName: string]: MongoDoc[] }
  indexes: { [collectionName: string]: MongoDoc[] }
}

export interface BackupOptions {
  payloadCollectionScopes?: {
    [collectionName: string]: CollectionCopyScope[]
  }
  versionCollectionModes?: VersionCollectionModes
}

/**
 * Creates a JSON representation of configured Payload collections in the MongoDB database.
 * @param connection - The Mongoose connection to the MongoDB database.
 * @returns A promise that resolves to a JSON string containing the backup data.
 */
export async function backup(
  connection: Connection,
  options: BackupOptions = {},
): Promise<BackupData> {
  const db = connection.db
  if (!db) {
    throw new Error('Could not make backup: database connection not established')
  }
  const collections = await db.listCollections().toArray()
  const existingCollectionNames = new Set(collections.map((collectionInfo) => collectionInfo.name))
  const payloadCollectionScopesByName = options.payloadCollectionScopes || {}
  const versionCollectionModesByName = options.versionCollectionModes || {}
  const targetCollectionNames = new Set([
    ...Object.keys(payloadCollectionScopesByName),
    ...Object.keys(versionCollectionModesByName),
  ])

  const backupData: BackupData = {
    collections: {},
    indexes: {},
  }

  for (const collectionName of Array.from(targetCollectionNames)) {
    if (!existingCollectionNames.has(collectionName)) {
      continue
    }

    const collection = db.collection(collectionName)
    const isBaseCollection = Object.prototype.hasOwnProperty.call(
      payloadCollectionScopesByName,
      collectionName,
    )

    if (isBaseCollection) {
      const scopes = payloadCollectionScopesByName[collectionName] || []
      backupData.collections[collectionName] = await getDocumentsByScopes(collection, scopes)
    } else {
      const versionMode = versionCollectionModesByName[collectionName]
      backupData.collections[collectionName] =
        versionMode.mode === 'all'
          ? await collection.find({}).toArray()
          : await getLatestXVersionsByParent(collection, versionMode.x)
    }

    // Backup indexes
    const indexes = await collection.indexes()
    backupData.indexes[collectionName] = indexes
  }

  return backupData
}

const getDocumentsByScopes = async (
  collection: MongoCollection,
  scopes: CollectionCopyScope[],
): Promise<MongoDoc[]> => {
  if (scopes.length === 0) {
    return []
  }

  const documents: MongoDoc[] = []
  for (const scope of scopes) {
    if (scope.mode.mode === 'none') {
      continue
    }

    const filter = scope.filter || {}
    const scopedDocs =
      scope.mode.mode === 'latest-x'
        ? await getLatestXDocuments(collection, scope.mode.x, filter)
        : await collection.find(filter).toArray()
    documents.push(...scopedDocs)
  }

  return documents
}

const getLatestXDocuments = (
  collection: MongoCollection,
  count: number,
  filter: Record<string, unknown>,
): Promise<MongoDoc[]> => {
  const maxDocs = Math.max(0, Math.floor(count))
  if (maxDocs < 1) {
    return Promise.resolve([])
  }

  return collection.find(filter).sort({ updatedAt: -1 }).limit(maxDocs).toArray()
}

const getLatestXVersionsByParent = async (
  collection: MongoCollection,
  count: number,
): Promise<MongoDoc[]> => {
  const maxPerDocument = Math.max(0, Math.floor(count))
  if (maxPerDocument < 1) {
    return []
  }

  // Fast path: Payload maintains one latest=true version per parent.
  if (maxPerDocument === 1) {
    return collection.find({ latest: true }).toArray()
  }

  const supportsTopN = await detectTopNSupport(collection)
  return supportsTopN
    ? getLatestXVersionsWithTopN(collection, maxPerDocument)
    : getLatestXVersionsWithFallback(collection, maxPerDocument)
}

const getTopNCacheKey = (
  collection: MongoCollection,
): { key: object; kind: 'object' } | { key: string; kind: 'string' } => {
  const collectionRecord = collection as unknown as Record<string, unknown>
  const db = collectionRecord.db

  if ((typeof db === 'object' || typeof db === 'function') && db !== null) {
    return {
      key: db,
      kind: 'object',
    }
  }

  const dbName =
    (collectionRecord.dbName as string | undefined) ??
    (collectionRecord.namespace as string | undefined) ??
    collection.collectionName ??
    'unknown-db'
  return {
    key: String(dbName),
    kind: 'string',
  }
}

const detectTopNSupport = async (collection: MongoCollection): Promise<boolean> => {
  const cacheKey = getTopNCacheKey(collection)
  const cached =
    cacheKey.kind === 'object'
      ? topNSupportByDbObjectKey.get(cacheKey.key)
      : topNSupportByDbStringKey.get(cacheKey.key)

  if (typeof cached === 'boolean') {
    return cached
  }

  try {
    await collection
      .aggregate([
        { $limit: 1 },
        {
          $group: {
            _id: null,
            docs: {
              $topN: {
                n: 1,
                output: '$$ROOT',
                sortBy: { _id: -1 },
              },
            },
          },
        },
      ])
      .toArray()
    if (cacheKey.kind === 'object') {
      topNSupportByDbObjectKey.set(cacheKey.key, true)
    } else {
      topNSupportByDbStringKey.set(cacheKey.key, true)
    }
    return true
  } catch (_error) {
    // If probing fails for any reason, fall back to the compatible pipeline.
    if (cacheKey.kind === 'object') {
      topNSupportByDbObjectKey.set(cacheKey.key, false)
    } else {
      topNSupportByDbStringKey.set(cacheKey.key, false)
    }
    return false
  }
}

const getLatestXVersionsWithTopN = (
  collection: MongoCollection,
  maxPerDocument: number,
): Promise<MongoDoc[]> => {
  return collection
    .aggregate(
      [
        {
          $group: {
            _id: '$parent',
            docs: {
              $topN: {
                n: maxPerDocument,
                output: '$$ROOT',
                sortBy: {
                  // Payload list views query versions with { latest: true } when drafts are enabled.
                  // Prioritize latest=true so latest-x copies remain visible in admin list views.
                  _id: -1,
                  latest: -1,
                  updatedAt: -1,
                },
              },
            },
          },
        },
        {
          $unwind: '$docs',
        },
        {
          $replaceRoot: {
            newRoot: '$docs',
          },
        },
      ],
      {
        allowDiskUse: true,
      },
    )
    .toArray()
}

const getLatestXVersionsWithFallback = (
  collection: MongoCollection,
  maxPerDocument: number,
): Promise<MongoDoc[]> => {
  return collection
    .aggregate(
      [
        {
          $sort: {
            parent: 1,
            // Keep the latest=true version at the front for each parent group.
            _id: -1,
            latest: -1,
            updatedAt: -1,
          },
        },
        {
          $group: {
            _id: '$parent',
            docs: {
              $push: '$$ROOT',
            },
          },
        },
        {
          $project: {
            docs: {
              $slice: ['$docs', maxPerDocument],
            },
          },
        },
        {
          $unwind: '$docs',
        },
        {
          $replaceRoot: {
            newRoot: '$docs',
          },
        },
      ],
      {
        allowDiskUse: true,
      },
    )
    .toArray()
}

/**
 * Restores the database with the data from the provided backup data.
 * @param connection - The Mongoose connection to the MongoDB database.
 * @param backupData - The backup data containing collections and indexes to restore.
 * @param logger - The Payload logger instance for logging restore operations.
 */
export async function restore(
  connection: Connection,
  backupData: BackupData,
  logger: BasePayload['logger'],
): Promise<void> {
  const db = connection.db
  if (!db) {
    throw new Error('Could not restore database: database connection not established')
  }

  try {
    await connection.dropDatabase()
  } catch {
    logger.debug('Failed to drop database, deleting all documents in every collection instead')
    const existingCollections = await db.listCollections().toArray()
    // Drop each existing collection in parallel
    await Promise.all(
      existingCollections.map(async (collectionInfo) => {
        const collection = db.collection(collectionInfo.name)
        try {
          await collection.deleteMany({})
        } catch (error) {
          logger.warn(error, `Failed to delete documents from collection ${collectionInfo.name}`)
        }
      }),
    )
  }

  const allIndexResults: Array<{
    collectionName: string
    error?: unknown
    index: MongoDoc
    success: boolean
  }> = []

  for (const collectionName in backupData.collections) {
    const documents = backupData.collections[collectionName]
    const collection = db.collection(collectionName)

    // Restore documents
    if (documents.length > 0) {
      logger.debug(`Inserting ${documents.length} documents into ${collectionName}`)
      await collection.insertMany(documents)
    }

    // Restore indexes
    const indexes = backupData.indexes[collectionName] || []
    // Create all indexes in parallel
    const indexResults = await Promise.all(
      indexes
        .filter((index) => index.name !== '_id_') // Skip _id index as it's created automatically
        .map(async (index) => {
          logger.debug(`Creating index ${index.name} on ${collectionName}`)

          // Create options object with only essential properties
          const indexOptions: Record<string, unknown> = {
            name: index.name,
            background: true, // This is generally safe to always include
          }

          // Only add optional properties if they are explicitly true
          if (index.unique === true) {
            indexOptions.unique = true
          }
          if (index.sparse === true) {
            indexOptions.sparse = true
          }
          if (typeof index.expireAfterSeconds === 'number') {
            indexOptions.expireAfterSeconds = index.expireAfterSeconds
          }
          if (
            index.partialFilterExpression &&
            Object.keys(index.partialFilterExpression).length > 0
          ) {
            indexOptions.partialFilterExpression = index.partialFilterExpression
          }

          try {
            await collection.createIndex(index.key, indexOptions)
            return { collectionName, index, success: true }
          } catch (error) {
            return { collectionName, error, index, success: false }
          }
        }),
    )

    allIndexResults.push(...indexResults)
  }

  // Check results and log summary across all collections
  const allFailed = allIndexResults.every((result) => !result.success)
  if (allFailed && allIndexResults.length > 0) {
    logger.warn('Failed to create indexes (your development database might not support it)')
  } else {
    // Only log individual failures if not all indexes failed
    const failedResults = allIndexResults.filter((result) => !result.success)
    for (const result of failedResults) {
      logger.warn(
        result.error,
        `Failed to create index ${result.index.name} on collection ${result.collectionName}`,
      )
    }
  }
}

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { type BasePayload, buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { switchEnvPlugin } from '../../src/index.js'
import { dropSupersededFilenameIndexes } from '../../src/lib/db/dropSupersededFilenameIndexes.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

// Scoping upload filename uniqueness to the storage prefix means payload builds a
// compound { filename, prefix } unique index instead of the single-field
// { filename } one. A database first indexed before that change keeps the orphaned
// global `filename_1` index, and mongoose's autoIndex never drops it — so it keeps
// rejecting same-filename/different-prefix documents with a duplicate-key error
// ("ValidationError: filename"). The plugin drops that superseded index on init and
// on a runtime switch into the development cloud-storage environment.

interface MongoIndex {
  key: Record<string, number>
  name: string
  unique?: boolean
}

interface NativeCollection {
  createIndex: (
    keys: Record<string, number>,
    options: { name: string; unique: boolean },
  ) => Promise<unknown>
  deleteMany: (filter: Record<string, unknown>) => Promise<unknown>
  dropIndex: (name: string) => Promise<unknown>
  indexes: () => Promise<MongoIndex[]>
  insertOne: (doc: Record<string, unknown>) => Promise<{ insertedId: unknown }>
}

interface MongooseModel {
  collection: NativeCollection
  ensureIndexes: () => Promise<unknown>
  init: () => Promise<unknown>
}

const developmentFileStorage = {
  collections: { privateMedia: { prefix: 'private' } },
  mode: 'cloud-storage',
  prefix: 'staging',
} as const

describe('mongo: superseded filename index cleanup', () => {
  let server: MongoMemoryServer
  let payload: BasePayload

  const getModel = (): MongooseModel =>
    (payload.db as unknown as { collections: Record<string, MongooseModel> }).collections
      .privateMedia

  // Reproduce a database first indexed before uniqueness was scoped to the prefix:
  // a *unique* { filename: 1 } index named `filename_1`. With `filenameCompoundIndex`
  // set, payload instead builds a non-unique `filename_1` (from the field's
  // `index: true`) — same key and name, so the legacy unique one is dropped first to
  // install it, exactly as the two would collide by name on a real upgraded database.
  const seedOrphanedGlobalIndex = async (collection: NativeCollection) => {
    await collection.deleteMany({})
    try {
      await collection.dropIndex('filename_1')
    } catch {
      // No existing filename_1 index to replace.
    }
    await collection.createIndex({ filename: 1 }, { name: 'filename_1', unique: true })
  }

  beforeAll(async () => {
    server = await MongoMemoryServer.create()
    const uri = `${server.getUri()}supersede`
    const dbArgs = { url: uri }

    const config = await buildConfig({
      ...sharedConfigDefaults,
      collections: [
        {
          slug: 'privateMedia',
          fields: [
            // Mirrors the hidden prefix field @payloadcms/plugin-cloud-storage adds.
            { name: 'prefix', type: 'text', admin: { hidden: true }, defaultValue: 'private' },
          ],
          upload: true,
        },
      ],
      db: mongooseAdapter(dbArgs),
      plugins: [
        switchEnvPlugin({
          db: { developmentArgs: dbArgs, function: mongooseAdapter, productionArgs: dbArgs },
          developmentFileStorage,
          developmentSafetyMode: false,
          payloadVersion: '3.84.1',
        }),
      ],
      secret: 'test-secret-do-not-use-in-prod',
    })

    payload = await getPayload({
      config: Promise.resolve(config),
      key: 'switch-env-test-supersede',
    } as Parameters<typeof getPayload>[0])

    // Ensure the compound { filename, prefix } unique index has finished building.
    await getModel().init()
  })

  afterAll(async () => {
    await payload?.db.destroy?.()
    await server?.stop()
  })

  it('builds a compound { filename, prefix } unique index for the upload collection', async () => {
    const indexes = await getModel().collection.indexes()
    const compound = indexes.find(
      (index) =>
        index.unique === true &&
        Object.keys(index.key).length > 1 &&
        'filename' in index.key &&
        'prefix' in index.key,
    )
    expect(compound).toBeTruthy()
  })

  it('drops a superseded single-field filename unique index while keeping the compound one', async () => {
    const { collection } = getModel()
    await seedOrphanedGlobalIndex(collection)
    expect((await collection.indexes()).some((index) => index.name === 'filename_1')).toBe(true)

    await dropSupersededFilenameIndexes({ developmentFileStorage, env: 'development', payload })

    const indexes = await collection.indexes()
    expect(indexes.some((index) => index.name === 'filename_1')).toBe(false)
    expect(
      indexes.some(
        (index) =>
          index.unique === true && Object.keys(index.key).length > 1 && 'filename' in index.key,
      ),
    ).toBe(true)
  })

  it('ensures the compound replacement when it is missing, then drops the stale index', async () => {
    // Reproduces the real boot path: while the stale unique `filename_1` exists,
    // autoIndex can't build the schema indexes, so the compound replacement may
    // not be present when the heal runs. The function must (re)create it itself
    // rather than wait on autoIndex / model.init().
    const { collection } = getModel()
    await collection.deleteMany({})
    try {
      await collection.dropIndex('filename_1_prefix_1')
    } catch {
      // No compound index present.
    }
    await seedOrphanedGlobalIndex(collection)

    const before = await collection.indexes()
    expect(
      before.some(
        (index) =>
          index.unique === true && Object.keys(index.key).length > 1 && 'filename' in index.key,
      ),
    ).toBe(false)

    await dropSupersededFilenameIndexes({ developmentFileStorage, env: 'development', payload })

    const after = await collection.indexes()
    // Stale single-field unique index is gone...
    expect(after.some((index) => index.name === 'filename_1' && index.unique === true)).toBe(false)
    // ...and the compound replacement was created before it was dropped.
    expect(
      after.some(
        (index) =>
          index.unique === true &&
          Object.keys(index.key).length > 1 &&
          'filename' in index.key &&
          'prefix' in index.key,
      ),
    ).toBe(true)
  })

  it('the orphaned global index blocks cross-prefix duplicates; dropping it unblocks them', async () => {
    const { collection } = getModel()
    await seedOrphanedGlobalIndex(collection)

    await collection.insertOne({ filename: 'shared.csv', prefix: 'private' })
    // Same filename under a different prefix — a distinct storage key, but the
    // global filename_1 index rejects it.
    await expect(
      collection.insertOne({ filename: 'shared.csv', prefix: 'staging/private' }),
    ).rejects.toMatchObject({ code: 11000 })

    await dropSupersededFilenameIndexes({ developmentFileStorage, env: 'development', payload })

    // Now permitted: the compound index treats (filename, prefix) as the key.
    const inserted = await collection.insertOne({
      filename: 'shared.csv',
      prefix: 'staging/private',
    })
    expect(inserted.insertedId).toBeTruthy()
    // A true duplicate (same filename AND prefix) is still rejected by the compound index.
    await expect(
      collection.insertOne({ filename: 'shared.csv', prefix: 'private' }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  it('does not resurrect the dropped index on a rebuild — it is not in the schema', async () => {
    const model = getModel()
    await seedOrphanedGlobalIndex(model.collection)
    await dropSupersededFilenameIndexes({ developmentFileStorage, env: 'development', payload })

    // Re-run schema index creation, as a fresh connect's autoIndex would.
    await model.ensureIndexes()

    const indexes = await model.collection.indexes()
    const isSingleFilename = (index: MongoIndex) =>
      Object.keys(index.key).length === 1 && index.key.filename === 1
    // The unique single-field index stays gone: the schema never declared it.
    expect(indexes.some((index) => isSingleFilename(index) && index.unique === true)).toBe(false)
    // The schema's non-unique filename index is (re)created and left untouched.
    expect(indexes.some((index) => isSingleFilename(index) && index.unique !== true)).toBe(true)
    // The compound unique index remains.
    expect(
      indexes.some(
        (index) =>
          index.unique === true && Object.keys(index.key).length > 1 && 'filename' in index.key,
      ),
    ).toBe(true)
  })

  it('is a no-op in the production environment (leaves the global index in place)', async () => {
    const { collection } = getModel()
    await seedOrphanedGlobalIndex(collection)

    await dropSupersededFilenameIndexes({ developmentFileStorage, env: 'production', payload })

    expect((await collection.indexes()).some((index) => index.name === 'filename_1')).toBe(true)
  })
})

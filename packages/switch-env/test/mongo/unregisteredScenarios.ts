import type { BasePayload } from 'payload'

import { afterEach, expect, it } from 'vitest'

import type { CopyConfig } from '../../src/types.js'
import type { CopyScenarioContext } from '../shared/copyScenarios.js'

// A sibling deployment's collections: two sites share one database, and each
// only registers its own `pages` collection (plus whatever else it owns), so
// from this config's point of view site B's collections don't exist. Copying
// production must still be able to carry them over — otherwise the target loses
// every document the other site owns.
const SITE_B_PAGES = 'site-b-pages'
const SITE_B_PAGES_VERSIONS = '_site-b-pages_versions'
const SITE_B_ANALYTICS = 'site-b-analytics'
const SITE_B_GLOBAL_TYPE = 'site-b-settings'
const GLOBALS_COLLECTION = 'globals'

const RAW_COLLECTIONS = [SITE_B_PAGES, SITE_B_PAGES_VERSIONS, SITE_B_ANALYTICS]

const COPY_UNREGISTERED: CopyConfig = {
  documents: { default: { mode: 'all' } },
  unregistered: { default: { mode: 'all' } },
}

interface RawCollection {
  countDocuments: (filter?: Record<string, unknown>) => Promise<number>
  createIndex: (keys: Record<string, number>, options?: Record<string, unknown>) => Promise<unknown>
  deleteMany: (filter: Record<string, unknown>) => Promise<unknown>
  find: (filter?: Record<string, unknown>) => {
    toArray: () => Promise<Record<string, unknown>[]>
  }
  indexes: () => Promise<Array<{ name?: string }>>
  insertMany: (docs: Record<string, unknown>[]) => Promise<unknown>
}

interface RawDb {
  collection: (name: string) => RawCollection
  dropCollection: (name: string) => Promise<unknown>
}

const getRawDb = (payload: BasePayload): RawDb => {
  const db = (payload.db as unknown as { connection?: { db?: RawDb } }).connection?.db
  if (!db) {
    throw new Error('mongo connection not established')
  }
  return db
}

const seedSiteBPages = (payload: BasePayload) =>
  getRawDb(payload)
    .collection(SITE_B_PAGES)
    .insertMany([
      { slug: 'home', title: 'Site B home' },
      { slug: 'about', title: 'Site B about' },
    ])

/** Three versions of one parent, shaped like payload's own version documents. */
const seedSiteBVersions = (payload: BasePayload) =>
  getRawDb(payload)
    .collection(SITE_B_PAGES_VERSIONS)
    .insertMany([
      {
        latest: null,
        parent: 'site-b-parent',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: { title: 'v1' },
      },
      {
        latest: null,
        parent: 'site-b-parent',
        updatedAt: '2026-01-02T00:00:00.000Z',
        version: { title: 'v2' },
      },
      {
        latest: true,
        parent: 'site-b-parent',
        updatedAt: '2026-01-03T00:00:00.000Z',
        version: { title: 'v3' },
      },
    ])

const seedSiteBGlobal = (payload: BasePayload) =>
  getRawDb(payload)
    .collection(GLOBALS_COLLECTION)
    .insertMany([{ globalType: SITE_B_GLOBAL_TYPE, siteName: 'Site B' }])

const titlesIn = async (payload: BasePayload, collectionName: string): Promise<string[]> => {
  const docs = await getRawDb(payload).collection(collectionName).find({}).toArray()
  return docs.map((doc) => String(doc.title)).sort()
}

/**
 * Mongo-only scenarios for `copy.unregistered`: collections that exist in the
 * source database with no counterpart in this payload config. Registered
 * collections are covered by the shared scenarios.
 */
export const registerUnregisteredCollectionScenarios = (
  getContext: () => CopyScenarioContext,
): void => {
  afterEach(async () => {
    const { sourcePayload, targetPayload } = getContext()
    for (const payload of [sourcePayload, targetPayload]) {
      const db = getRawDb(payload)
      for (const collectionName of RAW_COLLECTIONS) {
        // Absent on the target whenever the copy under test skipped it.
        await db.dropCollection(collectionName).catch(() => undefined)
      }
      await db
        .collection(GLOBALS_COLLECTION)
        .deleteMany({ globalType: SITE_B_GLOBAL_TYPE })
        .catch(() => undefined)
    }
  })

  it('skips unregistered collections by default', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBPages(sourcePayload)
    await runCopy()

    expect(await getRawDb(targetPayload).collection(SITE_B_PAGES).countDocuments()).toBe(0)
  })

  it('copies unregistered collections when copy.unregistered opts in', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBPages(sourcePayload)
    await runCopy(COPY_UNREGISTERED)

    expect(await titlesIn(targetPayload, SITE_B_PAGES)).toEqual(['Site B about', 'Site B home'])

    // Document IDs must survive, or relationships between the other site's
    // collections would break in the target.
    const sourceIds = (await getRawDb(sourcePayload).collection(SITE_B_PAGES).find({}).toArray())
      .map((doc) => String(doc._id))
      .sort()
    const targetIds = (await getRawDb(targetPayload).collection(SITE_B_PAGES).find({}).toArray())
      .map((doc) => String(doc._id))
      .sort()
    expect(targetIds).toEqual(sourceIds)
  })

  it('recreates the indexes of an unregistered collection', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBPages(sourcePayload)
    await getRawDb(sourcePayload)
      .collection(SITE_B_PAGES)
      .createIndex({ slug: 1 }, { name: 'slug_1', unique: true })

    await runCopy(COPY_UNREGISTERED)

    const indexes = await getRawDb(targetPayload).collection(SITE_B_PAGES).indexes()
    expect(indexes.map((index) => index.name)).toContain('slug_1')
  })

  it('honors a per-collection override for an unregistered collection', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBPages(sourcePayload)
    await getRawDb(sourcePayload)
      .collection(SITE_B_ANALYTICS)
      .insertMany([{ title: 'pageview' }, { title: 'pageview' }])

    await runCopy({
      documents: { default: { mode: 'all' } },
      unregistered: {
        collections: { [SITE_B_ANALYTICS]: { mode: 'none' } },
        default: { mode: 'all' },
      },
    })

    expect(await titlesIn(targetPayload, SITE_B_PAGES)).toEqual(['Site B about', 'Site B home'])
    expect(await getRawDb(targetPayload).collection(SITE_B_ANALYTICS).countDocuments()).toBe(0)
  })

  it('bounds an unregistered version collection with copy.versions.default', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBVersions(sourcePayload)

    await runCopy({
      documents: { default: { mode: 'all' } },
      unregistered: { default: { mode: 'all' } },
      versions: { default: { mode: 'latest-x', x: 1 } },
    })

    const copied = await getRawDb(targetPayload)
      .collection(SITE_B_PAGES_VERSIONS)
      .find({})
      .toArray()
    expect(copied).toHaveLength(1)
    expect((copied[0]?.version as { title?: string }).title).toBe('v3')
  })

  it('lets an override copy every version of an unregistered version collection', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBVersions(sourcePayload)

    await runCopy({
      documents: { default: { mode: 'all' } },
      unregistered: {
        collections: { [SITE_B_PAGES_VERSIONS]: { mode: 'all' } },
        default: { mode: 'all' },
      },
      versions: { default: { mode: 'latest-x', x: 1 } },
    })

    const copied = await getRawDb(targetPayload)
      .collection(SITE_B_PAGES_VERSIONS)
      .find({})
      .toArray()
    expect(copied).toHaveLength(3)
  })

  it('skips globals of unregistered global slugs by default', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBGlobal(sourcePayload)
    await runCopy()

    const copied = await getRawDb(targetPayload)
      .collection(GLOBALS_COLLECTION)
      .countDocuments({ globalType: SITE_B_GLOBAL_TYPE })
    expect(copied).toBe(0)
  })

  it('copies globals of unregistered global slugs when copy.unregistered opts in', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await seedSiteBGlobal(sourcePayload)
    await sourcePayload.updateGlobal({
      slug: 'site-settings',
      data: { siteName: 'Site A' },
    })

    await runCopy(COPY_UNREGISTERED)

    const copied = await getRawDb(targetPayload)
      .collection(GLOBALS_COLLECTION)
      .find({ globalType: SITE_B_GLOBAL_TYPE })
      .toArray()
    expect(copied).toHaveLength(1)
    expect(copied[0]?.siteName).toBe('Site B')

    // The registered global still copies exactly once — the leftovers scope
    // must not duplicate what the per-slug scopes already cover.
    const registered = await getRawDb(targetPayload)
      .collection(GLOBALS_COLLECTION)
      .countDocuments({ globalType: 'site-settings' })
    expect(registered).toBe(1)
  })
}

/**
 * Regression coverage for backfilling VERSION snapshots on drafts-enabled
 * collections.
 *
 * `backfillPaths` writes `path` to the main row via `db.updateOne`, which never
 * touches `_<collection>_versions`. For a drafts collection the admin list and
 * every `draft: true` read come from the version snapshot — so a doc imported
 * without a path (or fixed by an older, main-only backfill) keeps serving a
 * pathless snapshot forever. These tests pin that the backfill now repairs the
 * latest (and latest published) snapshot too, independently of the main row.
 */
import type { JsonObject, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backfillPaths, definePathsConfig, pathsPlugin, verifyPathIntegrity } from '../src/index.js'

const titleAndSlug = [
  { name: 'title', type: 'text' as const, required: true },
  { name: 'slug', type: 'text' as const, required: true },
]

const pathsConfig = definePathsConfig({
  collections: {
    articles: { strategy: 'flat' },
    pages: {},
  },
})

let payload: Payload
let destroy: () => Promise<void>

beforeAll(async () => {
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-backfillver-'))
  const dbFile = path.join(tmpDir, 'test.db')
  const config = await buildConfig({
    collections: [
      { slug: 'articles', fields: [...titleAndSlug], versions: { drafts: true } },
      { slug: 'pages', fields: [...titleAndSlug], versions: { drafts: true } },
    ],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
    plugins: [
      nestedDocsPlugin({ collections: ['pages'] }),
      // Backfill OFF so each test controls exactly when it runs.
      pathsPlugin({ ...pathsConfig, backfill: 'off' }),
    ],
    secret: 'backfillver-secret',
    telemetry: false,
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config, key: tmpDir })
  destroy = async () => {
    if (typeof payload?.db?.destroy === 'function') {
      await payload.db.destroy()
    }
    fs.rmSync(tmpDir, { force: true, recursive: true })
  }
})

afterAll(async () => {
  await destroy?.()
})

/** Stored `path` on the main (published) row. */
const mainPath = async (collection: 'articles' | 'pages', id: number | string) => {
  const doc = (await payload.findByID({ id, collection, draft: false })) as JsonObject
  return typeof doc.path === 'string' ? doc.path : null
}

/**
 * RAW stored `path` on the latest version snapshot — read via the adapter, the
 * way the admin list does. (`findByID({ draft: true })` merges in the main row
 * when there is no newer draft, so it can't see a stale snapshot.)
 */
const versionPath = async (collection: 'articles' | 'pages', id: number | string) => {
  const { docs } = await payload.db.findVersions({
    collection,
    limit: 1,
    where: { and: [{ parent: { equals: id } }, { latest: { equals: true } }] },
  })
  const stored = docs[0]?.version?.path
  return typeof stored === 'string' ? stored : null
}

/** Null the main row's path, bypassing hooks (mimics a raw import). */
const nullMainPath = (collection: 'articles' | 'pages', id: number | string) =>
  payload.db.updateOne({ id, collection, data: { path: null }, returning: false })

/** How many main rows still have a null path. */
const nullMainCount = async (collection: 'articles' | 'pages') =>
  (await payload.db.count({ collection, where: { path: { equals: null } } })).totalDocs

/** Null every version snapshot's path for a doc, bypassing hooks. */
const nullVersionPaths = async (collection: 'articles' | 'pages', id: number | string) => {
  const { docs } = await payload.db.findVersions({
    collection,
    where: { parent: { equals: id } },
  })
  for (const v of docs) {
    await payload.db.updateVersion({
      id: v.id,
      collection,
      returning: false,
      versionData: { version: { ...v.version, path: null } },
    })
  }
}

describe('backfill repairs version snapshots', () => {
  it('repairs both the main row and the version snapshot for an imported pathless doc', async () => {
    const doc = await payload.create({
      collection: 'articles',
      data: { slug: 'imported', _status: 'published', title: 'Imported' },
      draft: false,
    })
    expect(doc.path).toBe('/imported')

    // Mimic a raw import: no path in the main row OR the version snapshot.
    await nullMainPath('articles', doc.id)
    await nullVersionPaths('articles', doc.id)
    expect(await mainPath('articles', doc.id)).toBeNull()
    expect(await versionPath('articles', doc.id)).toBeNull()

    const report = await backfillPaths(payload, { collections: ['articles'], mode: 'fix' })
    const articles = report.collections.find((c) => c.collection === 'articles')
    expect(articles?.fixed).toBeGreaterThanOrEqual(1)
    expect(articles?.versionsFixed).toBeGreaterThanOrEqual(1)

    expect(await mainPath('articles', doc.id)).toBe('/imported')
    expect(await versionPath('articles', doc.id)).toBe('/imported')
  })

  it('repairs a stale version snapshot even when the main row already has a path (the regression)', async () => {
    const doc = await payload.create({
      collection: 'articles',
      data: { slug: 'main-ok', _status: 'published', title: 'Main OK' },
      draft: false,
    })

    // The state an older main-only backfill leaves: main row correct, snapshot stale.
    await nullVersionPaths('articles', doc.id)
    expect(await mainPath('articles', doc.id)).toBe('/main-ok')
    expect(await versionPath('articles', doc.id)).toBeNull()

    const report = await backfillPaths(payload, { collections: ['articles'], mode: 'fix' })
    const articles = report.collections.find((c) => c.collection === 'articles')
    // No main row needed fixing, but the snapshot did.
    expect(articles?.versionsFixed).toBeGreaterThanOrEqual(1)

    expect(await versionPath('articles', doc.id)).toBe('/main-ok')
  })

  it('computes nested version paths from the parent chain', async () => {
    const parent = await payload.create({
      collection: 'pages',
      data: { slug: 'parent', _status: 'published', title: 'Parent' },
      draft: false,
    })
    const child = await payload.create({
      collection: 'pages',
      data: { slug: 'child', _status: 'published', parent: parent.id, title: 'Child' },
      draft: false,
    })
    expect(child.path).toBe('/parent/child')

    await nullVersionPaths('pages', child.id)
    expect(await versionPath('pages', child.id)).toBeNull()

    await backfillPaths(payload, { collections: ['pages'], mode: 'fix' })
    expect(await versionPath('pages', child.id)).toBe('/parent/child')
  })

  it('verifyPathIntegrity flags a stale version snapshot and fixes it', async () => {
    const doc = await payload.create({
      collection: 'articles',
      data: { slug: 'verify-me', _status: 'published', title: 'Verify' },
      draft: false,
    })
    await nullVersionPaths('articles', doc.id)

    const issues = await verifyPathIntegrity(payload, { collections: ['articles'] })
    const versionIssue = issues.find((i) => i.version)
    expect(versionIssue).toBeDefined()
    expect(versionIssue?.expectedPath).toBe('/verify-me')
    expect(versionIssue?.storedPath).toBeNull()

    await verifyPathIntegrity(payload, { collections: ['articles'], fix: true })
    expect(await versionPath('articles', doc.id)).toBe('/verify-me')
    const after = await verifyPathIntegrity(payload, { collections: ['articles'] })
    expect(after.length).toBe(0)
  })

  it('keeps per-collection reports aligned when several are gated in one run', async () => {
    // The gate counts fan out concurrently; this guards that each collection's
    // counts are mapped back to its own report (a swap would misattribute them).
    // `articles` has a null main row + null snapshot; `pages` has only a null
    // snapshot — so the two reports must differ in the right direction.
    const article = await payload.create({
      collection: 'articles',
      data: { slug: 'multi-article', _status: 'published', title: 'Multi Article' },
      draft: false,
    })
    const page = await payload.create({
      collection: 'pages',
      data: { slug: 'multi-page', _status: 'published', title: 'Multi Page' },
      draft: false,
    })

    await nullMainPath('articles', article.id)
    await nullVersionPaths('articles', article.id)
    await nullVersionPaths('pages', page.id)

    const report = await backfillPaths(payload, {
      collections: ['articles', 'pages'],
      mode: 'fix',
    })
    const articles = report.collections.find((c) => c.collection === 'articles')
    const pages = report.collections.find((c) => c.collection === 'pages')

    // articles: main row was null → fixed, plus its snapshot.
    expect(articles?.fixed).toBeGreaterThanOrEqual(1)
    expect(articles?.versionsFixed).toBeGreaterThanOrEqual(1)
    // pages: main row already had a path → nothing to fix there, only the snapshot.
    expect(pages?.fixed).toBe(0)
    expect(pages?.versionsFixed).toBeGreaterThanOrEqual(1)

    expect(await mainPath('articles', article.id)).toBe('/multi-article')
    expect(await versionPath('articles', article.id)).toBe('/multi-article')
    expect(await versionPath('pages', page.id)).toBe('/multi-page')
  })

  it('repairs every pathless row in one pass, concurrently', async () => {
    // A dozen rows exercises the concurrent write batch, and asserting nothing
    // is left over proves the repair always runs to completion (no cap).
    const created: { id: number | string; slug: string }[] = []
    for (let i = 0; i < 12; i += 1) {
      const slug = `bulk-${i}`
      const doc = await payload.create({
        collection: 'articles',
        data: { slug, _status: 'published', title: `Bulk ${i}` },
        draft: false,
      })
      created.push({ id: doc.id, slug })
      await nullMainPath('articles', doc.id)
    }
    expect(await nullMainCount('articles')).toBe(12)

    const report = await backfillPaths(payload, { collections: ['articles'], mode: 'fix' })
    expect(report.collections.find((c) => c.collection === 'articles')?.fixed).toBe(12)
    expect(await nullMainCount('articles')).toBe(0)
    expect(await mainPath('articles', created[0].id)).toBe('/bulk-0')
    expect(await mainPath('articles', created[11].id)).toBe('/bulk-11')
  })
})

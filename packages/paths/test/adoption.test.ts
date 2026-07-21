/**
 * Coverage for the adoption-support surface: findPathCollisions,
 * checkPathsAdoption, and scope-aware listPaths. Uses sqlite (the stale-index
 * reconcile is Mongo-only and verified separately against real Mongo).
 */
import type { Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPathsResolver } from '../src/exports/resolver.js'
import {
  checkPathsAdoption,
  createParentField,
  definePathsConfig,
  findPathCollisions,
  pathsPlugin,
} from '../src/index.js'

const pathsConfig = definePathsConfig({
  collections: {
    items: {},
    'tenant-items': { scopeField: 'tenant', strategy: 'parent' },
  },
})

let payload: Payload
let destroy: () => Promise<void>

beforeAll(async () => {
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-adoption-'))
  const dbFile = path.join(tmpDir, 'test.db')
  const config = await buildConfig({
    collections: [
      {
        slug: 'items',
        // slug intentionally NOT required, so a slugless (unroutable) doc can exist.
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'slug', type: 'text' },
        ],
        versions: { drafts: true },
      },
      { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
      {
        slug: 'tenant-items',
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'slug', type: 'text', required: true },
          { name: 'tenant', type: 'relationship', relationTo: 'tenants' },
          createParentField('tenant-items'),
        ],
      },
    ],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
    plugins: [pathsPlugin({ ...pathsConfig, backfill: 'off' })],
    secret: 'adoption-secret',
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

describe('findPathCollisions', () => {
  it('detects two published docs forced onto the same path', async () => {
    const a = await payload.create({
      collection: 'items',
      data: { slug: 'coll-a', _status: 'published', title: 'A' },
      draft: false,
    })
    const b = await payload.create({
      collection: 'items',
      data: { slug: 'coll-b', _status: 'published', title: 'B' },
      draft: false,
    })
    // Force a collision the way a backfill or direct write would (bypass hooks).
    await payload.db.updateOne({
      id: b.id,
      collection: 'items',
      data: { path: '/coll-a' },
      returning: false,
    })

    const collisions = await findPathCollisions(payload, { collections: ['items'] })
    const clash = collisions.find((entry) => entry.path === '/coll-a')
    expect(clash).toBeDefined()
    expect(clash?.ids.map(String).sort()).toEqual([a.id, b.id].map(String).sort())

    // Repair so later tests see a clean slate.
    await payload.db.updateOne({
      id: b.id,
      collection: 'items',
      data: { path: '/coll-b' },
      returning: false,
    })
    const after = await findPathCollisions(payload, { collections: ['items'] })
    expect(after.find((entry) => entry.path === '/coll-a')).toBeUndefined()
  })

  it('does not flag the same path in different scopes as a collision', async () => {
    const tenantA = await payload.create({ collection: 'tenants', data: { name: 'A' } })
    const tenantB = await payload.create({ collection: 'tenants', data: { name: 'B' } })
    await payload.create({
      collection: 'tenant-items',
      data: { slug: 'about', tenant: tenantA.id, title: 'About A' },
    })
    await payload.create({
      collection: 'tenant-items',
      data: { slug: 'about', tenant: tenantB.id, title: 'About B' },
    })

    const collisions = await findPathCollisions(payload, { collections: ['tenant-items'] })
    expect(collisions).toHaveLength(0)
  })
})

describe('checkPathsAdoption', () => {
  it('reports missing slugs, null paths, and passes/fails accordingly', async () => {
    // A slugless (unroutable) published doc.
    await payload.create({
      collection: 'items',
      data: { _status: 'published', title: 'No slug' },
      draft: false,
    })

    const report = await checkPathsAdoption(payload, { collections: ['items'], log: false })
    const items = report.collections.find((entry) => entry.collection === 'items')
    expect(items?.missingSlug).toBeGreaterThanOrEqual(1)
    expect(items?.nullPath).toBeGreaterThanOrEqual(1)
    expect(report.ok).toBe(false)
  })

  it('detects URL changes via legacyUrlFor for redirect planning', async () => {
    const doc = await payload.create({
      collection: 'items',
      data: { slug: 'moved-page', _status: 'published', title: 'Moved' },
      draft: false,
    })

    const report = await checkPathsAdoption(payload, {
      collections: ['items'],
      // Pretend the old scheme served this doc at a different URL.
      legacyUrlFor: (candidate) => (candidate.slug === 'moved-page' ? '/legacy/moved-page' : null),
      log: false,
    })
    const items = report.collections.find((entry) => entry.collection === 'items')
    const change = items?.urlChanges?.find((entry) => entry.id === doc.id)
    expect(change).toEqual({ id: doc.id, from: '/legacy/moved-page', to: '/moved-page' })
  })
})

describe('scope-aware listPaths', () => {
  it('dedupes across scopes and filters to one scope', async () => {
    const tenantA = await payload.create({ collection: 'tenants', data: { name: 'SA' } })
    const tenantB = await payload.create({ collection: 'tenants', data: { name: 'SB' } })
    await payload.create({
      collection: 'tenant-items',
      data: { slug: 'shared', tenant: tenantA.id, title: 'Shared A' },
    })
    await payload.create({
      collection: 'tenant-items',
      data: { slug: 'shared', tenant: tenantB.id, title: 'Shared B' },
    })
    await payload.create({
      collection: 'tenant-items',
      data: { slug: 'only-b', tenant: tenantB.id, title: 'Only B' },
    })

    const resolver = createPathsResolver({
      collection: 'tenant-items',
      config: pathsConfig,
      getPayload: () => Promise.resolve(payload),
    })

    const all = await resolver.listPaths()
    // '/shared' appears once despite existing in both tenants.
    expect(all.filter((entry) => entry === '/shared')).toHaveLength(1)
    expect(all).toContain('/only-b')

    const onlyA = await resolver.listPaths({ scope: tenantA.id as string })
    expect(onlyA).toContain('/shared')
    expect(onlyA).not.toContain('/only-b')

    const onlyB = await resolver.listPaths({ scope: tenantB.id as string })
    expect(onlyB.sort()).toEqual(['/only-b', '/shared'])
  })
})

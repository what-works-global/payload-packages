import type { MemoryReplSet } from '@whatworks/dev-fixture/memory-db'
import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { createMemoryReplSet } from '@whatworks/dev-fixture/memory-db'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { rbacPlugin } from '../../src/index.js'

/**
 * End-to-end reproduction of the onInit seeding failures on a replica set.
 *
 * A replica set (not a standalone mongod) is required: it's what makes Payload
 * wrap local writes in transactions, and the transaction is what turns the
 * fresh-database seed race into `WriteConflict` (112) /
 * `OperationNotSupportedInTransaction` (263). `next build` collects page data in
 * several worker processes at once, so many Payload instances seed the same
 * fresh database concurrently — simulated here by booting N instances with
 * distinct cache keys against one replica set.
 *
 * Not part of the CI peer matrix (that runs the fast, mocked `test:peer` suite);
 * run with `pnpm --filter @whatworks/payload-rbac test:mongo`.
 */

let replSet: MemoryReplSet

const buildRbacConfig = (uri: string) =>
  buildConfig({
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'posts', fields: [{ name: 'title', type: 'text' }] },
      { slug: 'tags', fields: [{ name: 'name', type: 'text' }] },
    ],
    db: mongooseAdapter({ url: uri }),
    plugins: [
      rbacPlugin({
        adminRole: 'Super Admin',
        roles: [
          { name: 'Admin', permissions: ['*'], protected: true },
          { name: 'Viewer', permissions: ['*:read'] },
          { name: 'Post Editor', permissions: ['posts:*', '*:read'] },
        ],
      }),
    ],
    secret: 'rbac-mongo-int-secret',
    telemetry: false,
  })

describe('rbac seeding on a replica set', () => {
  beforeAll(async () => {
    replSet = await createMemoryReplSet({ dbName: 'rbac-seed-int' })
  }, 120_000)

  afterAll(async () => {
    await replSet?.stop()
  })

  it('seeds a fresh database from many concurrent boots without errors or duplicates', async () => {
    const CONCURRENCY = 8
    const payloads = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_unused, i) => {
        const config = await buildRbacConfig(replSet.uri)
        // Distinct keys defeat getPayload's per-process cache, forcing an
        // independent init (and onInit seed) per "worker".
        return getPayload({ config, key: `rbac-seed-int-${i}` })
      }),
    )

    const roles = await payloads[0].find({ collection: 'roles', depth: 0, limit: 1000 })
    const names = roles.docs.map((doc) => (doc as unknown as { name: string }).name).sort()

    // Every predefined role exists exactly once — no boot crashed, no duplicates
    // slipped past the unique-index race guard.
    expect(names).toEqual(['Admin', 'Post Editor', 'Super Admin', 'Viewer'])

    await Promise.all(payloads.map((payload: Payload) => payload.db.destroy?.()))
  })
})

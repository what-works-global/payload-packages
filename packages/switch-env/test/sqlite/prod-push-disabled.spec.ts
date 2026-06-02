import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getDbaFunction } from '../../src/lib/db/getDbaFunction.js'
import { buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

const buildPostsCollections = (
  extraPostFields: CollectionConfig['fields'] = [],
): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'body', type: 'textarea' },
      ...extraPostFields,
    ],
  },
]

interface LibSqlClient {
  execute: (sql: string) => Promise<{ rows: Array<{ name: string }> }>
}

const postsColumns = async (payload: BasePayload): Promise<string[]> => {
  const client = (payload.db as unknown as { client: LibSqlClient }).client
  const result = await client.execute("PRAGMA table_info('posts')")
  return result.rows.map((r) => r.name)
}

// Reproduces the "edit a collection while connected to production" scenario:
// the production database sits at a base schema, while the running code's schema
// has gained an extra column. The production adapter is built through
// getDbaFunction, which forces `push: false`, so connecting must NOT alter the
// production database. Guards against a future Payload change to connect() that
// would re-enable the dev schema push.
describe('sqlite production adapter never pushes schema', () => {
  let workDir: string
  let prodUrl: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-nopush-'))
    prodUrl = `file:${join(workDir, 'prod.sqlite')}`

    // Stand up the production database at the BASE schema (no `subtitle`), then
    // close it so the file persists with that schema on disk.
    const seedConfig = await buildConfig({
      ...sharedConfigDefaults,
      collections: buildPostsCollections(),
      db: sqliteAdapter({ client: { url: prodUrl } }),
      globals: buildSharedGlobals(),
      secret: 'test-secret-do-not-use-in-prod',
    })
    const seedPayload = await getPayload({
      config: Promise.resolve(seedConfig),
      key: 'switch-env-test-sqlite-nopush-seed',
    } as Parameters<typeof getPayload>[0])
    expect(await postsColumns(seedPayload)).not.toContain('subtitle')
    await seedPayload.db.destroy?.()
  })

  afterAll(async () => {
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  it('leaves the production schema untouched when local code adds a column', async () => {
    // Production adapter built exactly as the plugin builds it — push is forced
    // off inside getDbaFunction for the 'production' env.
    const productionAdapterObj = getDbaFunction({
      developmentArgs: { client: { url: prodUrl } },
      function: sqliteAdapter,
      productionArgs: { client: { url: prodUrl } },
    })('production')

    // The running code's schema declares an extra `subtitle` column that the
    // production database does not have.
    const driftedConfig = await buildConfig({
      ...sharedConfigDefaults,
      collections: buildPostsCollections([{ name: 'subtitle', type: 'text' }]),
      db: productionAdapterObj,
      globals: buildSharedGlobals(),
      secret: 'test-secret-do-not-use-in-prod',
    })

    let prodModePayload: BasePayload | undefined
    try {
      // init() + connect() run here. With push:false this must not push schema.
      prodModePayload = await getPayload({
        config: Promise.resolve(driftedConfig),
        key: 'switch-env-test-sqlite-nopush-prodmode',
      } as Parameters<typeof getPayload>[0])

      // The production database must STILL lack the column — no auto-push.
      expect(await postsColumns(prodModePayload)).not.toContain('subtitle')
    } finally {
      await prodModePayload?.db.destroy?.()
    }
  })
})

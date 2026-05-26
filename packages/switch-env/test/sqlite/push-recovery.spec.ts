import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

// Mirrors buildSharedCollections() but lets the caller add extra fields onto
// `posts`. Used to give source and target diverging dev schemas so we can
// verify that the post-restore push reconciles the difference.
const buildPostsCollections = (
  extraPostFields: CollectionConfig['fields'] = [],
): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'body', type: 'textarea' },
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      ...extraPostFields,
    ],
    versions: true,
  },
  {
    slug: 'authors',
    fields: [{ name: 'name', type: 'text', required: true }],
  },
]

const makeConfig = (dbUrl: string, extraPostFields: CollectionConfig['fields'] = []) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: buildPostsCollections(extraPostFields),
    db: sqliteAdapter({ client: { url: dbUrl } }),
    globals: buildSharedGlobals(),
    secret: 'test-secret-do-not-use-in-prod',
  })

interface LibSqlClient {
  execute: (sql: string) => Promise<{
    columns: string[]
    rows: Array<Record<string, unknown>>
  }>
}

const sqliteClient = (payload: BasePayload): LibSqlClient =>
  (payload.db as unknown as { client: LibSqlClient }).client

describe('sqlite push-recovery', () => {
  let sourcePayload: BasePayload
  let targetPayload: BasePayload
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-push-'))

    // Source dev schema knows only the base fields; target dev schema adds an
    // unmigrated `subtitle` column to posts.
    const sourceConfig = await makeConfig(`file:${join(workDir, 'source.sqlite')}`)
    const targetConfig = await makeConfig(`file:${join(workDir, 'target.sqlite')}`, [
      { name: 'subtitle', type: 'text' },
    ])

    sourcePayload = await getPayload({
      config: Promise.resolve(sourceConfig),
      key: 'switch-env-test-sqlite-push-source',
    } as Parameters<typeof getPayload>[0])
    targetPayload = await getPayload({
      config: Promise.resolve(targetConfig),
      key: 'switch-env-test-sqlite-push-target',
    } as Parameters<typeof getPayload>[0])
  })

  afterAll(async () => {
    await sourcePayload?.db.destroy?.()
    await targetPayload?.db.destroy?.()
    if (workDir) {await rm(workDir, { force: true, recursive: true })}
  })

  it("restores the target's extra column via post-restore push", async () => {
    // Sanity-check: source DB does not have `subtitle` (dev push only wrote it to target).
    const sourceCols = await sqliteClient(sourcePayload).execute("PRAGMA table_info('posts')")
    expect(sourceCols.rows.some((r) => r.name === 'subtitle')).toBe(false)
    const targetColsBefore = await sqliteClient(targetPayload).execute(
      "PRAGMA table_info('posts')",
    )
    expect(targetColsBefore.rows.some((r) => r.name === 'subtitle')).toBe(true)

    await sourcePayload.create({
      collection: 'posts',
      data: { title: 'post in source' },
    })

    const backupData = await backupSql({
      copyConfig: { documents: { default: { mode: 'all' } } },
      payload: sourcePayload,
      sourceAdapter: sourcePayload.db,
    })

    // The captured schema is the source schema — so it should not declare `subtitle`.
    const postsCreate = backupData.schema.find((s) =>
      /CREATE TABLE\s+[`"']?posts[`"']?\s*\(/i.test(s),
    )
    expect(postsCreate, `schema entries: ${JSON.stringify(backupData.schema)}`).toBeDefined()
    expect(postsCreate?.toLowerCase()).not.toContain('subtitle')

    await restoreSql({
      backupData,
      logger: targetPayload.logger,
      payload: targetPayload,
      targetAdapter: targetPayload.db,
    })

    // After restore + push: target DB should have the subtitle column back.
    const targetColsAfter = await sqliteClient(targetPayload).execute(
      "PRAGMA table_info('posts')",
    )
    expect(targetColsAfter.rows.some((r) => r.name === 'subtitle')).toBe(true)

    // And it should be usable end-to-end via Payload's API.
    const created = await targetPayload.create({
      collection: 'posts',
      data: { subtitle: 'restored column', title: 'with subtitle' } as unknown as {
        title: string
      },
    })
    const reread = await targetPayload.findByID({ id: created.id, collection: 'posts' })
    expect((reread as unknown as { subtitle?: string }).subtitle).toBe('restored column')
  })
})

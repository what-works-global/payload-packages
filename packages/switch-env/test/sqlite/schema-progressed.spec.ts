import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'
import {
  buildAmbiguousCollections,
  buildProductionCollections,
  buildUnambiguousCollections,
} from '../shared/driftCollections.js'

interface LibSqlClient {
  execute: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const sqliteClient = (payload: BasePayload): LibSqlClient =>
  (payload.db as unknown as { client: LibSqlClient }).client

const makeConfig = (collections: CollectionConfig[], dbUrl: string) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections,
    db: sqliteAdapter({ client: { url: dbUrl } }),
    editor: lexicalEditor(),
    secret: 'test-secret-do-not-use-in-prod',
  })

const columnNames = async (payload: BasePayload, table: string): Promise<string[]> => {
  const result = await sqliteClient(payload).execute(`PRAGMA table_info("${table}")`)
  return result.rows.map((row) => String(row.name)).sort()
}

const tableExists = async (payload: BasePayload, table: string): Promise<boolean> => {
  const result = await sqliteClient(payload).execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
  )
  return result.rows.length > 0
}

describe('copy with a progressed development schema (sqlite)', () => {
  let workDir: string
  let sourcePayload: BasePayload
  let ambiguousPayload: BasePayload
  let unambiguousPayload: BasePayload

  const copyInto = (target: BasePayload) =>
    backupSql({
      copyConfig: { documents: { default: { mode: 'all' } } },
      payload: target,
      sourceAdapter: sourcePayload.db,
    }).then((backupData) =>
      restoreSql({
        backupData,
        logger: target.logger,
        payload: target,
        targetAdapter: target.db,
      }),
    )

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-drift-'))

    sourcePayload = await getPayload({
      config: Promise.resolve(
        await makeConfig(buildProductionCollections(), `file:${join(workDir, 'source.sqlite')}`),
      ),
      key: 'switch-env-test-sqlite-drift-source',
    } as Parameters<typeof getPayload>[0])
    ambiguousPayload = await getPayload({
      config: Promise.resolve(
        await makeConfig(buildAmbiguousCollections(), `file:${join(workDir, 'ambiguous.sqlite')}`),
      ),
      key: 'switch-env-test-sqlite-drift-ambiguous',
    } as Parameters<typeof getPayload>[0])
    unambiguousPayload = await getPayload({
      config: Promise.resolve(
        await makeConfig(
          buildUnambiguousCollections(),
          `file:${join(workDir, 'unambiguous.sqlite')}`,
        ),
      ),
      key: 'switch-env-test-sqlite-drift-unambiguous',
    } as Parameters<typeof getPayload>[0])

    // Production data, shaped by the production schema.
    const create = sourcePayload.create.bind(sourcePayload) as (args: {
      collection: string
      data: Record<string, unknown>
    }) => Promise<{ id: number | string }>
    await create({
      collection: 'posts',
      data: { legacy: 'still important in prod', status: 'published', title: 'prod post' },
    })
    await create({
      collection: 'archived-items',
      data: { name: 'prod-only table row' },
    })
  })

  afterAll(async () => {
    await sourcePayload?.db.destroy?.()
    await ambiguousPayload?.db.destroy?.()
    await unambiguousPayload?.db.destroy?.()
    await rm(workDir, { force: true, recursive: true })
  })

  it('pauses the reconcile on rename-shaped drift, leaving a lossless production replica', async () => {
    expect(await columnNames(sourcePayload, 'posts')).toContain('legacy')
    expect(await columnNames(ambiguousPayload, 'posts')).not.toContain('legacy')

    const result = await copyInto(ambiguousPayload)

    expect(result.deferredReconcile.length).toBeGreaterThan(0)
    expect(result.deferredReconcile.join('\n')).toContain('"posts"')

    // Pure replica: prod-only objects present, dev-only objects absent.
    const postColumns = await columnNames(ambiguousPayload, 'posts')
    expect(postColumns).toContain('legacy')
    expect(postColumns).not.toContain('subtitle')
    expect(postColumns).not.toContain('rating')
    expect(await tableExists(ambiguousPayload, 'archived_items')).toBe(true)
    expect(await tableExists(ambiguousPayload, 'reviews')).toBe(false)

    // Production data intact — including the column an automatic remove+add
    // reconcile would have discarded.
    const rows = await sqliteClient(ambiguousPayload).execute(
      `SELECT title, legacy FROM "posts" ORDER BY id`,
    )
    expect(rows.rows[0]?.legacy).toBe('still important in prod')

    // No batch=-1 dev row: a boot-time push inserts it after the renames are
    // resolved interactively.
    const devRows = await sqliteClient(ambiguousPayload).execute(
      `SELECT name FROM "payload_migrations" WHERE batch = -1`,
    )
    expect(devRows.rows).toHaveLength(0)
  })

  it('reconciles unambiguous drift headlessly (additions and deletions, no rename pairs)', async () => {
    const result = await copyInto(unambiguousPayload)
    expect(result.deferredReconcile).toEqual([])

    // Added column created; deleted collection dropped by the push — including
    // its FK column on payload_locked_documents_rels, which drizzle removes via
    // its own table recreation.
    const postColumns = await columnNames(unambiguousPayload, 'posts')
    expect(postColumns).toContain('subtitle')
    expect(postColumns).toContain('legacy')
    expect(await tableExists(unambiguousPayload, 'archived_items')).toBe(false)
    expect(await columnNames(unambiguousPayload, 'payload_locked_documents_rels')).not.toContain(
      'archived_items_id',
    )

    // Data landed and the admin API works against the reconciled schema.
    const posts = await unambiguousPayload.find({ collection: 'posts' })
    expect(posts.totalDocs).toBe(1)
    expect(posts.docs[0].title).toBe('prod post')
    expect((posts.docs[0] as Record<string, unknown>).legacy).toBe('still important in prod')

    // Sequences/rowids don't collide with the restored rows.
    const fresh = await unambiguousPayload.create({
      collection: 'posts',
      data: { title: 'created after copy' },
    } as Parameters<typeof unambiguousPayload.create>[0])
    expect(Number(fresh.id)).toBeGreaterThan(Number(posts.docs[0].id))

    // Exactly one batch=-1 "dev" row marks the database as push-managed again.
    const devRows = await sqliteClient(unambiguousPayload).execute(
      `SELECT name FROM "payload_migrations" WHERE batch = -1`,
    )
    expect(devRows.rows).toHaveLength(1)
  })
})

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'
import {
  buildAmbiguousCollections,
  buildProductionCollections,
  buildUnambiguousCollections,
} from '../shared/driftCollections.js'
import { type PostgresTestServer, startPostgres } from './server.js'

interface PgPoolLike {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const pgPool = (payload: BasePayload): PgPoolLike =>
  (payload.db as unknown as { pool: PgPoolLike }).pool

// See int.spec.ts — keeps idle-connection FATALs on cluster shutdown from
// crashing the run.
const silencePoolErrors = (adapter: unknown): void => {
  const pool = (adapter as { pool?: { on?: (event: string, cb: () => void) => void } }).pool
  pool?.on?.('error', () => {})
}

const makeConfig = (collections: CollectionConfig[], connectionString: string) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections,
    db: postgresAdapter({ pool: { connectionString } }),
    editor: lexicalEditor(),
    secret: 'test-secret-do-not-use-in-prod',
  })

const columnNames = async (payload: BasePayload, table: string): Promise<string[]> => {
  const result = await pgPool(payload).query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY column_name`,
    [table],
  )
  return result.rows.map((row) => String(row.column_name))
}

const tableExists = async (payload: BasePayload, table: string): Promise<boolean> => {
  const result = await pgPool(payload).query(`SELECT to_regclass($1) AS reg`, [
    `"public"."${table}"`,
  ])
  return result.rows[0]?.reg != null
}

describe('copy with a progressed development schema (postgres)', () => {
  let server: PostgresTestServer
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
    server = await startPostgres()
    await server.createDatabase('drift_source')
    await server.createDatabase('drift_ambiguous')
    await server.createDatabase('drift_unambiguous')

    sourcePayload = await getPayload({
      config: Promise.resolve(
        await makeConfig(buildProductionCollections(), server.connectionString('drift_source')),
      ),
      key: 'switch-env-test-postgres-drift-source',
    } as Parameters<typeof getPayload>[0])
    ambiguousPayload = await getPayload({
      config: Promise.resolve(
        await makeConfig(buildAmbiguousCollections(), server.connectionString('drift_ambiguous')),
      ),
      key: 'switch-env-test-postgres-drift-ambiguous',
    } as Parameters<typeof getPayload>[0])
    unambiguousPayload = await getPayload({
      config: Promise.resolve(
        await makeConfig(
          buildUnambiguousCollections(),
          server.connectionString('drift_unambiguous'),
        ),
      ),
      key: 'switch-env-test-postgres-drift-unambiguous',
    } as Parameters<typeof getPayload>[0])

    silencePoolErrors(sourcePayload.db)
    silencePoolErrors(ambiguousPayload.db)
    silencePoolErrors(unambiguousPayload.db)

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
    await server?.stop()
  })

  it('pauses the reconcile on rename-shaped drift, leaving a lossless production replica', async () => {
    // Sanity: the live schemas genuinely disagree before the copy.
    expect(await columnNames(sourcePayload, 'posts')).toContain('legacy')
    expect(await columnNames(ambiguousPayload, 'posts')).not.toContain('legacy')

    const result = await copyInto(ambiguousPayload)

    // The ambiguous pairs are reported for the endpoint message.
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
    const rows = await pgPool(ambiguousPayload).query(
      `SELECT title, legacy FROM "public"."posts" ORDER BY id`,
    )
    expect(rows.rows[0]?.legacy).toBe('still important in prod')

    // No batch=-1 dev row: a boot-time push inserts it after the renames are
    // resolved interactively.
    const devRows = await pgPool(ambiguousPayload).query(
      `SELECT name FROM "public"."payload_migrations" WHERE batch = -1`,
    )
    expect(devRows.rows).toHaveLength(0)
  })

  it('reconciles unambiguous drift headlessly (additions and deletions, no rename pairs)', async () => {
    const result = await copyInto(unambiguousPayload)
    expect(result.deferredReconcile).toEqual([])

    // Added column created; deleted collection dropped by the push — including
    // its FK column on payload_locked_documents_rels.
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

    // Sequences were advanced past the restored rows.
    const fresh = await unambiguousPayload.create({
      collection: 'posts',
      data: { title: 'created after copy' },
    } as Parameters<typeof unambiguousPayload.create>[0])
    expect(Number(fresh.id)).toBeGreaterThan(Number(posts.docs[0].id))

    // Exactly one batch=-1 "dev" row marks the database as push-managed again.
    const devRows = await pgPool(unambiguousPayload).query(
      `SELECT name FROM "public"."payload_migrations" WHERE batch = -1`,
    )
    expect(devRows.rows).toHaveLength(1)
  })
})

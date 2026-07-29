import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { describeRestoreResult } from '../../src/lib/utils.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'
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

// `views` is a numeric column with a numeric default — the shape that makes
// drizzle-kit re-emit a no-op `ALTER COLUMN ... SET DEFAULT` on every diff, even
// against a database that already matches the code exactly (see schemaDrift.ts).
// A migration-managed copy must not read that noise as "the schema was pushed".
const collections = (): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'views', type: 'number', defaultValue: 3 },
    ],
  },
]

const NOOP_MIGRATION = `
export const up = async () => {}
export const down = async () => {}
`

const devMarkerRows = async (payload: BasePayload): Promise<number> => {
  const result = await pgPool(payload).query(
    `SELECT name FROM "public"."payload_migrations" WHERE batch = -1`,
  )
  return result.rows.length
}

describe('postgres copy into a migration-managed target', () => {
  let server: PostgresTestServer
  let sourcePayload: BasePayload
  let targetPayload: BasePayload
  let rejectTargetPayload: BasePayload
  let workDir: string

  const copyInto = (target: BasePayload) =>
    backupSql({
      copyConfig: { documents: { default: { mode: 'all' } } },
      payload: sourcePayload,
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
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-pg-migmanaged-'))
    const migrationDir = join(workDir, 'migrations')
    await mkdir(migrationDir, { recursive: true })
    await writeFile(join(migrationDir, '20260101_000000_init.js'), NOOP_MIGRATION)

    server = await startPostgres()
    await server.createDatabase('migmanaged_source')
    await server.createDatabase('migmanaged_target')
    await server.createDatabase('migmanaged_reject')

    // Source stands in for production: built by push so the tables exist, then
    // its history rewritten to a migration-managed one (positive batch, no
    // dev-push marker).
    sourcePayload = await getPayload({
      config: Promise.resolve(
        await buildConfig({
          ...sharedConfigDefaults,
          collections: collections(),
          db: postgresAdapter({
            pool: { connectionString: server.connectionString('migmanaged_source') },
          }),
          editor: lexicalEditor(),
          secret: 'test-secret-do-not-use-in-prod',
        }),
      ),
      key: 'switch-env-test-postgres-migmanaged-source',
    } as Parameters<typeof getPayload>[0])

    await pgPool(sourcePayload).query(`DELETE FROM "public"."payload_migrations" WHERE batch = -1`)
    await pgPool(sourcePayload).query(
      `INSERT INTO "public"."payload_migrations" (name, batch, updated_at, created_at)
       VALUES ('20260101_000000_init', 1, now(), now())`,
    )

    const makeTarget = async (database: string, key: string) =>
      getPayload({
        config: Promise.resolve(
          await buildConfig({
            ...sharedConfigDefaults,
            collections: collections(),
            db: postgresAdapter({
              migrationDir,
              pool: { connectionString: server.connectionString(database) },
              // The consumer's explicit "this database's schema only changes
              // through migrations" declaration — what a hosted staging app
              // sets for its development adapter.
              push: false,
            }),
            editor: lexicalEditor(),
            secret: 'test-secret-do-not-use-in-prod',
          }),
        ),
        key,
      } as Parameters<typeof getPayload>[0])

    targetPayload = await makeTarget(
      'migmanaged_target',
      'switch-env-test-postgres-migmanaged-target',
    )
    rejectTargetPayload = await makeTarget(
      'migmanaged_reject',
      'switch-env-test-postgres-migmanaged-reject',
    )

    silencePoolErrors(sourcePayload.db)
    silencePoolErrors(targetPayload.db)
    silencePoolErrors(rejectTargetPayload.db)

    await sourcePayload.create({ collection: 'posts', data: { title: 'prod post', views: 7 } })
  })

  afterAll(async () => {
    await sourcePayload?.db.destroy?.()
    await targetPayload?.db.destroy?.()
    await rejectTargetPayload?.db.destroy?.()
    await server?.stop()
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  it('never writes the dev-push marker, so a later `payload migrate` cannot prompt', async () => {
    const result = await copyInto(targetPayload)

    expect(result.schemaMode).toBe('migration-managed')
    expect(result.migrationError).toBeUndefined()
    expect(result.pendingMigrations).toEqual([])
    expect(result.migrationsChecked).toBe(true)
    expect(await devMarkerRows(targetPayload)).toBe(0)

    const rows = await pgPool(targetPayload).query(
      `SELECT name, batch FROM "public"."payload_migrations" ORDER BY name`,
    )
    expect(rows.rows.map((row) => [row.name, Number(row.batch)])).toEqual([
      ['20260101_000000_init', 1],
    ])

    const posts = await targetPayload.find({ collection: 'posts' })
    expect(posts.docs.map((doc) => (doc as unknown as { title: string }).title)).toEqual([
      'prod post',
    ])
  })

  it('does not report drizzle-kit no-op drift as an incomplete copy', async () => {
    const result = await copyInto(targetPayload)

    // `views` (numeric with a numeric default) may make drizzle-kit re-emit a
    // SET DEFAULT statement against this perfectly in-sync database. It is
    // reported for the operator's information, but it must not flip the copy to
    // incomplete — and above all it must not cause a marker to be written.
    for (const statement of result.unresolvedDrift) {
      expect(statement).toMatch(/SET DEFAULT/i)
    }
    expect(describeRestoreResult(result)).toEqual({ detail: null, incomplete: false })
    expect(await devMarkerRows(targetPayload)).toBe(0)
  })

  it('refuses a source carrying a dev-push marker, before DROP SCHEMA runs', async () => {
    await pgPool(sourcePayload).query(
      `INSERT INTO "public"."payload_migrations" (name, batch, updated_at, created_at)
       VALUES ('dev', -1, now(), now())`,
    )
    // A witness the destructive restore would wipe.
    await pgPool(rejectTargetPayload).query(`CREATE TABLE "public"."canary" (id integer)`)
    await pgPool(rejectTargetPayload).query(`INSERT INTO "public"."canary" (id) VALUES (1)`)

    try {
      await expect(copyInto(rejectTargetPayload)).rejects.toThrow(/dev schema-push marker/)

      const canary = await pgPool(rejectTargetPayload).query(`SELECT id FROM "public"."canary"`)
      expect(canary.rows).toHaveLength(1)
    } finally {
      await pgPool(sourcePayload).query(
        `DELETE FROM "public"."payload_migrations" WHERE batch = -1`,
      )
    }
  })
})

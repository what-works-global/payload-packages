import { postgresAdapter } from '@payloadcms/db-postgres'
import { type BasePayload, getPayload } from 'payload'
import { expect, it } from 'vitest'

import { getDbaFunction } from '../../src/lib/db/getDbaFunction.js'
import { openAdapter } from '../../src/lib/db/openAdapter.js'
import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { runCopyScenarios } from '../shared/copyScenarios.js'
import { makePostgresConfig } from './config.js'
import { type PostgresTestServer, startPostgres } from './server.js'

interface PgPoolLike {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const pgPool = (payload: BasePayload): PgPoolLike =>
  (payload.db as unknown as { pool: PgPoolLike }).pool

// payload's postgres `destroy()` resets in-memory state but does NOT close the
// `pg` pool, and its `connectWithReconnect` keeps a client checked out (so
// `pool.end()` would hang). When the embedded cluster shuts down those idle
// connections raise a FATAL 57P01 that the pool re-emits as an `error` event;
// attaching a no-op listener keeps it from crashing the run on teardown.
const silencePoolErrors = (adapter: unknown): void => {
  const pool = (adapter as { pool?: { on?: (event: string, cb: () => void) => void } }).pool
  pool?.on?.('error', () => {})
}

const countRows = async (payload: BasePayload, table: string): Promise<number> => {
  const result = await pgPool(payload).query(`SELECT COUNT(*) AS c FROM "public"."${table}"`)
  return Number(result.rows[0]?.c ?? 0)
}

// Module-scoped so the `extras` callbacks (which run before beforeAll resolves)
// can reach the live server once it has booted.
let server: PostgresTestServer | undefined
let sourceDbUrl = ''

runCopyScenarios(
  {
    name: 'postgres',
    copy: async (source, target, { copyConfig }) => {
      const backupData = await backupSql({
        copyConfig,
        payload: source,
        sourceAdapter: source.db,
      })
      await restoreSql({
        backupData,
        logger: target.logger,
        payload: target,
        targetAdapter: target.db,
      })
    },
    setupPayloads: async () => {
      server = await startPostgres()
      await server.createDatabase('source')
      await server.createDatabase('target')
      sourceDbUrl = server.connectionString('source')

      const sourceConfig = await makePostgresConfig({ connectionString: sourceDbUrl })
      const targetConfig = await makePostgresConfig({
        connectionString: server.connectionString('target'),
      })

      const sourcePayload = await getPayload({
        config: Promise.resolve(sourceConfig),
        key: 'switch-env-test-postgres-source',
      } as Parameters<typeof getPayload>[0])
      const targetPayload = await getPayload({
        config: Promise.resolve(targetConfig),
        key: 'switch-env-test-postgres-target',
      } as Parameters<typeof getPayload>[0])

      silencePoolErrors(sourcePayload.db)
      silencePoolErrors(targetPayload.db)

      return {
        cleanup: async () => {
          await sourcePayload.db.destroy?.()
          await targetPayload.db.destroy?.()
          await server?.stop()
          server = undefined
        },
        sourcePayload,
        targetPayload,
      }
    },
  },
  {
    extras: (getContext) => {
      it('openAdapter forces push:false on the secondary adapter', async () => {
        const { sourcePayload } = getContext()
        const getDb = getDbaFunction({
          developmentArgs: { pool: { connectionString: sourceDbUrl } },
          function: (args: Parameters<typeof postgresAdapter>[0]) => postgresAdapter(args),
          productionArgs: { pool: { connectionString: sourceDbUrl } },
        })

        const adapter = await openAdapter(sourcePayload, 'production', getDb)
        try {
          expect((adapter as unknown as { push?: boolean }).push).toBe(false)
          expect((adapter as unknown as { pool?: unknown }).pool).toBeDefined()
        } finally {
          silencePoolErrors(adapter)
          await adapter.destroy?.()
        }
      })

      it('recreates the full set of production schema objects on the target', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()

        await runCopy()

        // Snapshot every schema-level object kind the DDL capture reconstructs.
        // Compared as sets (ordered by name) — replay may renumber ordinal
        // positions, which is fine; names, types, defaults, constraint and
        // index definitions must survive the round trip exactly.
        const snapshot = async (payload: BasePayload) => {
          const pool = pgPool(payload)
          const q = async (text: string) => (await pool.query(text)).rows
          return {
            columns: await q(
              `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
               FROM information_schema.columns WHERE table_schema = 'public'
               ORDER BY table_name, column_name`,
            ),
            constraints: await q(
              `SELECT conrelid::regclass::text AS table_name, conname,
                      pg_get_constraintdef(oid) AS definition
               FROM pg_constraint WHERE connamespace = 'public'::regnamespace
               ORDER BY conname`,
            ),
            enums: await q(
              `SELECT t.typname, e.enumlabel FROM pg_type t
               JOIN pg_enum e ON e.enumtypid = t.oid
               JOIN pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname = 'public'
               ORDER BY t.typname, e.enumsortorder`,
            ),
            indexes: await q(
              `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
               ORDER BY indexname`,
            ),
            sequences: await q(
              `SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
               ORDER BY sequencename`,
            ),
            tables: await q(
              `SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
               ORDER BY table_name`,
            ),
          }
        }

        expect(await snapshot(targetPayload)).toEqual(await snapshot(sourcePayload))
      })

      it('copies payload_migrations rows from source to target', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()

        const sourceRows = await pgPool(sourcePayload).query(
          'SELECT name, batch FROM "public"."payload_migrations" ORDER BY name',
        )
        // Sanity check: dev push always writes at least one row with batch = -1.
        expect(sourceRows.rows.length).toBeGreaterThanOrEqual(1)

        await runCopy()

        const targetRows = await pgPool(targetPayload).query(
          'SELECT name, batch FROM "public"."payload_migrations" ORDER BY name',
        )
        expect(targetRows.rows.map((r) => [r.name, String(r.batch)])).toEqual(
          sourceRows.rows.map((r) => [r.name, String(r.batch)]),
        )
      })

      it('resets identity sequences so new inserts do not collide after copy', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()

        // `posts` has drafts enabled, so creating one also writes a `_posts_v`
        // row — this exercises sequence reset on both the base and version table.
        const created = await sourcePayload.create({
          collection: 'posts',
          data: { title: 'seq-source' },
        })

        await runCopy()

        // The copied row keeps its original primary key.
        const copied = await targetPayload.findByID({ id: created.id, collection: 'posts' })
        expect(copied.id).toBe(created.id)

        // Without a sequence reset this insert would collide on the copied id.
        const fresh = await targetPayload.create({
          collection: 'posts',
          data: { title: 'seq-after-copy' },
        })
        expect(Number(fresh.id)).toBeGreaterThan(Number(created.id))
      })

      it('copies side-table rows for arrays, blocks, hasMany select, and relationships', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()

        const a1 = await sourcePayload.create({
          collection: 'authors',
          data: { name: 'PG Side Author A' },
        })
        const a2 = await sourcePayload.create({
          collection: 'authors',
          data: { name: 'PG Side Author B' },
        })

        await sourcePayload.create({
          collection: 'kitchen-sink',
          data: {
            arrayField: [
              { itemNumber: 1, itemText: 'a' },
              { itemNumber: 2, itemText: 'b' },
              { itemNumber: 3, itemText: 'c' },
            ],
            blocksField: [
              { blockType: 'heroBlock', heading: 'h1' },
              { blockType: 'heroBlock', heading: 'h2' },
              { blockType: 'quoteBlock', quote: 'q1' },
            ],
            manyRel: [a1.id, a2.id],
            selectManyField: ['red', 'green', 'blue'],
            singleRel: a1.id,
            textField: 'side-table doc',
          },
        } as Parameters<typeof sourcePayload.create>[0])

        // Discover the actual side-table names — Drizzle's naming has historically
        // varied between snake_case conventions across versions, so look them up.
        const sourceTables = await pgPool(sourcePayload).query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name LIKE 'kitchen_sink%'`,
        )
        const names = sourceTables.rows.map((r) => String(r.table_name))
        const find = (pred: (n: string) => boolean): string => {
          const match = names.find(pred)
          if (!match) {
            throw new Error(
              `Could not find expected kitchen_sink side table among: ${names.join(', ')}`,
            )
          }
          return match
        }

        const arrayTable = find((n) => /array/i.test(n) && !/_locales|_rels/i.test(n))
        const heroBlocksTable = find((n) => /blocks.*hero/i.test(n))
        const quoteBlocksTable = find((n) => /blocks.*quote/i.test(n))
        const selectManyTable = find((n) => /select_many/i.test(n))
        const relsTable = find((n) => /_rels$/.test(n))

        const sourceCounts = {
          array: await countRows(sourcePayload, arrayTable),
          hero: await countRows(sourcePayload, heroBlocksTable),
          quote: await countRows(sourcePayload, quoteBlocksTable),
          rels: await countRows(sourcePayload, relsTable),
          selectMany: await countRows(sourcePayload, selectManyTable),
        }

        // Sanity: source matches what we wrote.
        expect(sourceCounts.array).toBe(3)
        expect(sourceCounts.hero).toBe(2)
        expect(sourceCounts.quote).toBe(1)
        expect(sourceCounts.selectMany).toBe(3)
        // Only hasMany relationships populate the *_rels table; the non-hasMany
        // singleRel lives as a direct FK column on kitchen_sink.
        expect(sourceCounts.rels).toBe(2)

        await runCopy()

        const targetCounts = {
          array: await countRows(targetPayload, arrayTable),
          hero: await countRows(targetPayload, heroBlocksTable),
          quote: await countRows(targetPayload, quoteBlocksTable),
          rels: await countRows(targetPayload, relsTable),
          selectMany: await countRows(targetPayload, selectManyTable),
        }

        expect(targetCounts).toEqual(sourceCounts)
      })

      it('captures only extensions installed in the copied schema and skips un-droppable extension views', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()
        const source = pgPool(sourcePayload)
        const target = pgPool(targetPayload)

        try {
          // Provider-managed extension outside the copied schema (Supabase's
          // `extensions`/`vault`, Neon's `neon`): must not be captured — on a
          // local target it is either unavailable (noisy skip) or, worse,
          // available and installed into the dev schema, where its objects
          // break every later Drizzle push.
          await source.query(`CREATE SCHEMA IF NOT EXISTS provider_ext`)
          await source.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA provider_ext`)
          // An extension installed IN the copied schema is part of the replica
          // (RDS-style setups: CREATE EXTENSION defaults to public). This one
          // owns views, which the reconcile push diffs as unknown and tries to
          // DROP — Postgres refuses (2BP01), and the copy must skip that
          // instead of failing.
          await source.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`)

          const backupData = await backupSql({
            copyConfig: { documents: { default: { mode: 'all' } } },
            payload: sourcePayload,
            sourceAdapter: sourcePayload.db,
          })
          const extensionStatements = backupData.schema.filter((statement) =>
            statement.startsWith('CREATE EXTENSION'),
          )
          expect(extensionStatements).toEqual([
            'CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"',
          ])

          await runCopy()

          const targetExtensions = await target.query(
            `SELECT e.extname, n.nspname FROM pg_extension e
             JOIN pg_namespace n ON n.oid = e.extnamespace`,
          )
          const schemaByExtension = Object.fromEntries(
            targetExtensions.rows.map((row) => [String(row.extname), String(row.nspname)]),
          )
          expect(schemaByExtension['pg_stat_statements']).toBe('public')
          expect(schemaByExtension['uuid-ossp']).toBeUndefined()

          // The extension's views survived (they can never be dropped by a
          // push) and the reconcile still completed: the dev row is present.
          const views = await target.query(
            `SELECT viewname FROM pg_views
             WHERE schemaname = 'public' AND viewname LIKE 'pg_stat_statements%'`,
          )
          expect(views.rows.length).toBeGreaterThan(0)
          const devRow = await target.query(
            `SELECT name FROM "public"."payload_migrations" WHERE batch = -1`,
          )
          expect(devRow.rows).toHaveLength(1)
        } finally {
          await source.query(`DROP EXTENSION IF EXISTS pg_stat_statements`)
          await source.query(`DROP SCHEMA IF EXISTS provider_ext CASCADE`)
          await target.query(`DROP EXTENSION IF EXISTS pg_stat_statements`)
        }
      })
    },
  },
)

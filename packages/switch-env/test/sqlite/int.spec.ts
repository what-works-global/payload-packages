import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, getPayload } from 'payload'
import { expect, it } from 'vitest'

import { getDbaFunction } from '../../src/lib/db/getDbaFunction.js'
import { openAdapter } from '../../src/lib/db/openAdapter.js'
import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { runCopyScenarios } from '../shared/copyScenarios.js'
import { makeSqliteConfig } from './config.js'

interface LibSqlClient {
  execute: (sql: string) => Promise<{
    columns: string[]
    rows: Array<Record<string, unknown>>
  }>
}

const sqliteClient = (payload: BasePayload): LibSqlClient =>
  (payload.db as unknown as { client: LibSqlClient }).client

runCopyScenarios(
  {
    name: 'sqlite',
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
      const workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-'))
      const sourceConfig = await makeSqliteConfig({
        dbUrl: `file:${join(workDir, 'source.sqlite')}`,
      })
      const targetConfig = await makeSqliteConfig({
        dbUrl: `file:${join(workDir, 'target.sqlite')}`,
      })

      const sourcePayload = await getPayload({
        config: Promise.resolve(sourceConfig),
        key: 'switch-env-test-sqlite-source',
      } as Parameters<typeof getPayload>[0])
      const targetPayload = await getPayload({
        config: Promise.resolve(targetConfig),
        key: 'switch-env-test-sqlite-target',
      } as Parameters<typeof getPayload>[0])

      return {
        cleanup: async () => {
          await sourcePayload.db.destroy?.()
          await targetPayload.db.destroy?.()
          await rm(workDir, { force: true, recursive: true })
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
        const secondaryFile = join(tmpdir(), `switch-env-openadapter-${Date.now()}.sqlite`)
        const getDb = getDbaFunction({
          developmentArgs: { client: { url: `file:${secondaryFile}` } },
          function: (args: Parameters<typeof sqliteAdapter>[0]) => sqliteAdapter(args),
          productionArgs: { client: { url: `file:${secondaryFile}` } },
        })

        const adapter = await openAdapter(sourcePayload, 'production', getDb)
        try {
          expect((adapter as unknown as { push?: boolean }).push).toBe(false)
          expect((adapter as unknown as { client?: unknown }).client).toBeDefined()
        } finally {
          await adapter.destroy?.()
          await rm(secondaryFile, { force: true })
        }
      })

      it('copies payload_migrations rows from source to target', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()

        const sourceRows = await sqliteClient(sourcePayload).execute(
          'SELECT name, batch FROM payload_migrations ORDER BY name',
        )
        // Sanity check: dev push always writes at least one row with batch = -1.
        expect(sourceRows.rows.length).toBeGreaterThanOrEqual(1)

        await runCopy()

        const targetRows = await sqliteClient(targetPayload).execute(
          'SELECT name, batch FROM payload_migrations ORDER BY name',
        )
        expect(targetRows.rows.map((r) => [r.name, r.batch])).toEqual(
          sourceRows.rows.map((r) => [r.name, r.batch]),
        )
      })

      it('copies side-table rows for arrays, blocks, hasMany select, and relationships', async () => {
        const { runCopy, sourcePayload, targetPayload } = getContext()

        const a1 = await sourcePayload.create({
          collection: 'authors',
          data: { name: 'SQL Side Author A' },
        })
        const a2 = await sourcePayload.create({
          collection: 'authors',
          data: { name: 'SQL Side Author B' },
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
        const sourceTables = await sqliteClient(sourcePayload).execute(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kitchen_sink%'",
        )
        const names = sourceTables.rows.map((r) => String(r.name))
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

        const countRows = async (payload: BasePayload, table: string): Promise<number> => {
          const result = await sqliteClient(payload).execute(`SELECT COUNT(*) AS c FROM "${table}"`)
          return Number(result.rows[0]?.c ?? 0)
        }

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
    },
  },
)

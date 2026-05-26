import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

interface LibSqlClient {
  execute: (sql: string) => Promise<{
    columns: string[]
    rows: Array<Record<string, unknown>>
  }>
}

const sqliteClient = (payload: BasePayload): LibSqlClient =>
  (payload.db as unknown as { client: LibSqlClient }).client

const RENAME_MIGRATION_SOURCE = `
export const up = async ({ payload }) => {
  await payload.db.client.execute('ALTER TABLE posts RENAME COLUMN title TO heading')
}

export const down = async ({ payload }) => {
  await payload.db.client.execute('ALTER TABLE posts RENAME COLUMN heading TO title')
}
`

describe('sqlite migrate-recovery', () => {
  let sourcePayload: BasePayload
  let targetPayload: BasePayload
  let workDir: string
  let migrationDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-migrate-'))
    migrationDir = join(workDir, 'migrations')
    await mkdir(migrationDir, { recursive: true })
    await writeFile(
      join(migrationDir, '20260525_000001_rename_title_to_heading.js'),
      RENAME_MIGRATION_SOURCE,
    )

    // Source represents prod: posts still has `title` and the rename migration
    // has not run. Target represents dev: posts has `heading` directly (because
    // dev push wired it up that way at boot) and ships the rename migration file.
    const sourceConfig = await buildConfig({
      ...sharedConfigDefaults,
      collections: [
        {
          slug: 'posts',
          fields: [{ name: 'title', type: 'text', required: true }],
        },
      ],
      db: sqliteAdapter({ client: { url: `file:${join(workDir, 'source.sqlite')}` } }),
      secret: 'test-secret-do-not-use-in-prod',
    })

    const targetConfig = await buildConfig({
      ...sharedConfigDefaults,
      collections: [
        {
          slug: 'posts',
          fields: [{ name: 'heading', type: 'text', required: true }],
        },
      ],
      db: sqliteAdapter({
        client: { url: `file:${join(workDir, 'target.sqlite')}` },
        migrationDir,
      }),
      secret: 'test-secret-do-not-use-in-prod',
    })

    sourcePayload = await getPayload({
      config: Promise.resolve(sourceConfig),
      key: 'switch-env-test-sqlite-migrate-source',
    } as Parameters<typeof getPayload>[0])
    targetPayload = await getPayload({
      config: Promise.resolve(targetConfig),
      key: 'switch-env-test-sqlite-migrate-target',
    } as Parameters<typeof getPayload>[0])
  })

  afterAll(async () => {
    await sourcePayload?.db.destroy?.()
    await targetPayload?.db.destroy?.()
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  it('applies pending migrations so renamed columns inherit source data', async () => {
    // Sanity: source has `title`, target has `heading`.
    const sourceCols = await sqliteClient(sourcePayload).execute("PRAGMA table_info('posts')")
    expect(sourceCols.rows.some((r) => r.name === 'title')).toBe(true)
    expect(sourceCols.rows.some((r) => r.name === 'heading')).toBe(false)
    const targetColsBefore = await sqliteClient(targetPayload).execute("PRAGMA table_info('posts')")
    expect(targetColsBefore.rows.some((r) => r.name === 'heading')).toBe(true)
    expect(targetColsBefore.rows.some((r) => r.name === 'title')).toBe(false)

    const created = await sourcePayload.create({
      collection: 'posts',
      data: { title: 'hello prod' },
    })

    const backupData = await backupSql({
      copyConfig: { documents: { default: { mode: 'all' } } },
      payload: sourcePayload,
      sourceAdapter: sourcePayload.db,
    })
    await restoreSql({
      backupData,
      logger: targetPayload.logger,
      payload: targetPayload,
      targetAdapter: targetPayload.db,
    })

    // After restore + migrate + push: target column is `heading` again and the
    // source's `title` data has moved into it.
    const targetColsAfter = await sqliteClient(targetPayload).execute("PRAGMA table_info('posts')")
    expect(targetColsAfter.rows.some((r) => r.name === 'heading')).toBe(true)
    expect(targetColsAfter.rows.some((r) => r.name === 'title')).toBe(false)

    // Raw SQL: the row from source survived the column rename and now lives
    // under `heading`. This is the rename-preserves-data property.
    const rawRows = await sqliteClient(targetPayload).execute('SELECT id, heading FROM posts')
    expect(rawRows.rows.length).toBe(1)
    expect(rawRows.rows[0].heading).toBe('hello prod')

    const reread = await targetPayload.findByID({
      id: created.id,
      collection: 'posts',
    })
    expect((reread as unknown as { heading: string }).heading).toBe('hello prod')

    // payload_migrations should now show the rename file as applied (batch >= 1)
    // alongside the dev push marker (batch = -1) re-inserted by push.
    const migRows = await sqliteClient(targetPayload).execute(
      'SELECT name, batch FROM payload_migrations ORDER BY batch',
    )
    const names = migRows.rows.map((r) => String(r.name))
    expect(names.some((n) => n.includes('rename_title_to_heading'))).toBe(true)
    expect(migRows.rows.some((r) => Number(r.batch) === -1)).toBe(true)
  })
})

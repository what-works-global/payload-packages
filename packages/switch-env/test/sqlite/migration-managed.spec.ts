import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import type { RestoreSqlResult } from '../../src/lib/db/sql.js'

import { backupSql, restoreSql } from '../../src/lib/db/sql.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

interface LibSqlClient {
  execute: (sql: string) => Promise<{
    columns: string[]
    rows: Array<Record<string, unknown>>
  }>
}

const client = (payload: BasePayload): LibSqlClient =>
  (payload.db as unknown as { client: LibSqlClient }).client

const postsColumns = async (payload: BasePayload): Promise<string[]> => {
  const result = await client(payload).execute("PRAGMA table_info('posts')")
  return result.rows.map((row) => String(row.name))
}

const migrationRows = async (
  payload: BasePayload,
): Promise<Array<{ batch: number; name: string }>> => {
  const result = await client(payload).execute(
    'SELECT name, batch FROM payload_migrations ORDER BY batch, name',
  )
  return result.rows.map((row) => ({ name: String(row.name), batch: Number(row.batch) }))
}

const devMarkerRows = async (payload: BasePayload): Promise<number> => {
  const result = await client(payload).execute(
    'SELECT name FROM payload_migrations WHERE batch = -1',
  )
  return result.rows.length
}

const postsCollection = (fields: CollectionConfig['fields']): CollectionConfig => ({
  slug: 'posts',
  fields,
})

// `process.env.NODE_ENV` is typed readonly once Next's types are in scope.
const setNodeEnv = (value: string | undefined): void => {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

const NOOP_MIGRATION = `
export const up = async () => {}
export const down = async () => {}
`

const ADD_SUBTITLE_MIGRATION = `
export const up = async ({ payload }) => {
  await payload.db.client.execute('ALTER TABLE posts ADD COLUMN subtitle text')
}
export const down = async ({ payload }) => {
  await payload.db.client.execute('ALTER TABLE posts DROP COLUMN subtitle')
}
`

// Data-only: no DDL at all, so a schema push could never stand in for it.
const BACKFILL_MIGRATION = `
export const up = async ({ payload }) => {
  await payload.db.client.execute("UPDATE posts SET title = 'migrated: ' || title")
}
export const down = async () => {}
`

const FAILING_MIGRATION = `
export const up = async () => {
  throw new Error('migration blew up')
}
export const down = async () => {}
`

interface ScenarioArgs {
  /** Files written to the target's migrationDir, keyed by filename. */
  migrationFiles?: Record<string, string>
  /** Migration names recorded on the SOURCE as already applied (batch 1). */
  sourceHistory?: string[]
  /** Leave the source's batch = -1 dev-push marker in place. */
  sourceKeepDevMarker?: boolean
  sourcePostFields?: CollectionConfig['fields']
  /** Omit to point the target at a migrationDir that does not exist. */
  targetHasMigrationDir?: boolean
  targetPostFields?: CollectionConfig['fields']
  /** Default false — i.e. migration-managed. */
  targetPush?: boolean
}

interface Scenario {
  cleanup: () => Promise<void>
  copy: () => Promise<RestoreSqlResult>
  sourcePayload: BasePayload
  targetPayload: BasePayload
}

let activeScenario: null | Scenario = null

afterEach(async () => {
  await activeScenario?.cleanup()
  activeScenario = null
})

const createScenario = async ({
  migrationFiles = {},
  sourceHistory = ['20260101_000000_init'],
  sourceKeepDevMarker = false,
  sourcePostFields = [{ name: 'title', type: 'text', required: true }],
  targetHasMigrationDir = true,
  targetPostFields = sourcePostFields,
  targetPush = false,
}: ScenarioArgs = {}): Promise<Scenario> => {
  const workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-migmanaged-'))
  const migrationDir = join(workDir, 'migrations')
  if (targetHasMigrationDir) {
    await mkdir(migrationDir, { recursive: true })
    for (const [name, source] of Object.entries(migrationFiles)) {
      await writeFile(join(migrationDir, name), source)
    }
  }

  // Source stands in for production: schema built by push (so the tables exist),
  // then its migration history rewritten to what a migration-managed production
  // actually carries — positive batches, no dev marker.
  const sourceConfig = await buildConfig({
    ...sharedConfigDefaults,
    collections: [postsCollection(sourcePostFields)],
    db: sqliteAdapter({ client: { url: `file:${join(workDir, 'source.sqlite')}` } }),
    secret: 'test-secret-do-not-use-in-prod',
  })
  const sourcePayload = await getPayload({
    config: Promise.resolve(sourceConfig),
    key: `switch-env-migmanaged-source-${workDir}`,
  } as Parameters<typeof getPayload>[0])

  if (!sourceKeepDevMarker) {
    await client(sourcePayload).execute('DELETE FROM payload_migrations WHERE batch = -1')
  }
  for (const name of sourceHistory) {
    await client(sourcePayload).execute(
      `INSERT INTO payload_migrations (name, batch, updated_at, created_at)
       VALUES ('${name}', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
  }

  const targetConfig = await buildConfig({
    ...sharedConfigDefaults,
    collections: [postsCollection(targetPostFields)],
    db: sqliteAdapter({
      client: { url: `file:${join(workDir, 'target.sqlite')}` },
      migrationDir: targetHasMigrationDir ? migrationDir : join(workDir, 'no-migrations'),
      push: targetPush,
    }),
    secret: 'test-secret-do-not-use-in-prod',
  })
  const targetPayload = await getPayload({
    config: Promise.resolve(targetConfig),
    key: `switch-env-migmanaged-target-${workDir}`,
  } as Parameters<typeof getPayload>[0])

  const scenario: Scenario = {
    cleanup: async () => {
      await sourcePayload.db.destroy?.()
      await targetPayload.db.destroy?.()
      await rm(workDir, { force: true, recursive: true })
    },
    copy: async () => {
      const backupData = await backupSql({
        copyConfig: { documents: { default: { mode: 'all' } } },
        payload: sourcePayload,
        sourceAdapter: sourcePayload.db,
      })
      return restoreSql({
        backupData,
        logger: targetPayload.logger,
        payload: targetPayload,
        targetAdapter: targetPayload.db,
      })
    },
    sourcePayload,
    targetPayload,
  }
  activeScenario = scenario
  return scenario
}

describe('sqlite copy into a migration-managed target', () => {
  it('leaves no dev-push marker behind, and stays clean when repeated', async () => {
    // The orgtracker incident: a copy into a migration-managed staging database
    // used to end with a batch = -1 row, which makes the next non-interactive
    // `payload migrate` (in the Vercel build) stop on an stdin prompt.
    const { copy, sourcePayload, targetPayload } = await createScenario({
      migrationFiles: { '20260101_000000_init.js': NOOP_MIGRATION },
    })
    await sourcePayload.create({ collection: 'posts', data: { title: 'hello prod' } })

    const first = await copy()

    expect(first.schemaMode).toBe('migration-managed')
    expect(first.migrationError).toBeUndefined()
    expect(first.pendingMigrations).toEqual([])
    expect(first.migrationsChecked).toBe(true)
    expect(await devMarkerRows(targetPayload)).toBe(0)
    expect(await migrationRows(targetPayload)).toEqual([{ name: '20260101_000000_init', batch: 1 }])
    const posts = await targetPayload.find({ collection: 'posts' })
    expect(posts.docs.map((doc) => (doc as unknown as { title: string }).title)).toEqual([
      'hello prod',
    ])

    // Idempotent: copying again must not accumulate a marker or history.
    const second = await copy()
    expect(second.pendingMigrations).toEqual([])
    expect(await devMarkerRows(targetPayload)).toBe(0)
    expect(await migrationRows(targetPayload)).toEqual([{ name: '20260101_000000_init', batch: 1 }])
  })

  it('treats NODE_ENV=production as migration-managed without any `push` setting', async () => {
    // Vercel sets NODE_ENV=production for every environment, staging included.
    // Payload never pushes there, so neither may this plugin — with or without
    // the consumer remembering `push: false`.
    const { copy, targetPayload } = await createScenario({
      migrationFiles: { '20260101_000000_init.js': NOOP_MIGRATION },
      targetPush: true,
    })

    const originalNodeEnv = process.env.NODE_ENV
    setNodeEnv('production')
    let result: RestoreSqlResult
    try {
      result = await copy()
    } finally {
      setNodeEnv(originalNodeEnv)
    }

    expect(result.schemaMode).toBe('migration-managed')
    expect(await devMarkerRows(targetPayload)).toBe(0)
  })

  it('refuses a source carrying a dev-push marker, before touching the target', async () => {
    const { copy, targetPayload } = await createScenario({ sourceKeepDevMarker: true })
    // A witness the destructive restore would wipe.
    await client(targetPayload).execute('CREATE TABLE canary (id integer)')
    await client(targetPayload).execute('INSERT INTO canary (id) VALUES (1)')

    await expect(copy()).rejects.toThrow(/dev schema-push marker/)

    const canary = await client(targetPayload).execute('SELECT id FROM canary')
    expect(canary.rows).toHaveLength(1)
  })

  it('applies a pending schema migration and records it without a marker', async () => {
    const { copy, sourcePayload, targetPayload } = await createScenario({
      migrationFiles: {
        '20260101_000000_init.js': NOOP_MIGRATION,
        '20260102_000000_add_subtitle.js': ADD_SUBTITLE_MIGRATION,
      },
      targetPostFields: [
        { name: 'title', type: 'text', required: true },
        { name: 'subtitle', type: 'text' },
      ],
    })
    await sourcePayload.create({ collection: 'posts', data: { title: 'hello prod' } })

    const result = await copy()

    expect(result.migrationError).toBeUndefined()
    expect(result.pendingMigrations).toEqual([])
    expect(await postsColumns(targetPayload)).toContain('subtitle')
    expect(await migrationRows(targetPayload)).toEqual([
      { name: '20260101_000000_init', batch: 1 },
      { name: '20260102_000000_add_subtitle', batch: 2 },
    ])
    expect(await devMarkerRows(targetPayload)).toBe(0)
    // Migrations brought the schema all the way to the code schema.
    expect(result.unresolvedDrift).toEqual([])
  })

  it('applies a pending data-only migration to the restored rows', async () => {
    const { copy, sourcePayload, targetPayload } = await createScenario({
      migrationFiles: {
        '20260101_000000_init.js': NOOP_MIGRATION,
        '20260102_000000_backfill.js': BACKFILL_MIGRATION,
      },
    })
    await sourcePayload.create({ collection: 'posts', data: { title: 'hello prod' } })

    const result = await copy()

    expect(result.migrationError).toBeUndefined()
    const rows = await client(targetPayload).execute('SELECT title FROM posts')
    expect(rows.rows.map((row) => String(row.title))).toEqual(['migrated: hello prod'])
    expect(await migrationRows(targetPayload)).toContainEqual({
      name: '20260102_000000_backfill',
      batch: 2,
    })
    expect(await devMarkerRows(targetPayload)).toBe(0)
  })

  it('reports a failed migration instead of pushing the schema in its place', async () => {
    const { copy, targetPayload } = await createScenario({
      migrationFiles: {
        '20260101_000000_init.js': NOOP_MIGRATION,
        '20260102_000000_add_subtitle.js': FAILING_MIGRATION,
      },
      targetPostFields: [
        { name: 'title', type: 'text', required: true },
        { name: 'subtitle', type: 'text' },
      ],
    })

    // Payload's runMigrationFile answers a throwing migration with
    // process.exit(1); the copy must turn that into a reported failure rather
    // than taking the server down (or, worse, reading as success).
    const result = await copy()

    expect(result.migrationError).toBeDefined()
    expect(result.pendingMigrations).toEqual(['20260102_000000_add_subtitle'])
    // No push substituted for the migration: the code's column is still absent.
    expect(await postsColumns(targetPayload)).not.toContain('subtitle')
    expect(await devMarkerRows(targetPayload)).toBe(0)
    expect(await migrationRows(targetPayload)).toEqual([{ name: '20260101_000000_init', batch: 1 }])
    expect(result.unresolvedDrift.join('\n')).toContain('subtitle')
  })

  it('reports migration state as unchecked when no migration directory is readable', async () => {
    // The serverless shape: the deployed bundle carries no `.ts` migrations.
    const { copy, targetPayload } = await createScenario({ targetHasMigrationDir: false })

    const result = await copy()

    expect(result.schemaMode).toBe('migration-managed')
    expect(result.migrationsChecked).toBe(false)
    expect(result.pendingMigrations).toEqual([])
    expect(await devMarkerRows(targetPayload)).toBe(0)
  })
})

describe('sqlite copy into a push-managed target', () => {
  it('still pushes dev-only schema changes and writes exactly one marker', async () => {
    const { copy, targetPayload } = await createScenario({
      sourceKeepDevMarker: true,
      targetPostFields: [
        { name: 'title', type: 'text', required: true },
        { name: 'subtitle', type: 'text' },
      ],
      targetPush: true,
    })

    const result = await copy()

    expect(result.schemaMode).toBe('push-managed')
    // Unmigrated dev drift is reconciled by the push, exactly as before.
    expect(await postsColumns(targetPayload)).toContain('subtitle')
    expect(await devMarkerRows(targetPayload)).toBe(1)
  })
})

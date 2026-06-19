import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { excludeFilenameIndexReshape, getSqlSchemaDrift } from '../../src/lib/db/schemaDrift.js'
import { buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

// Mirrors the push-recovery harness: two payloads whose `posts` schemas can
// diverge, so we can assert the dry-run diff detects (or doesn't detect) drift.
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

const makeConfig = (dbUrl: string, extraPostFields: CollectionConfig['fields'] = []) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: buildPostsCollections(extraPostFields),
    db: sqliteAdapter({ client: { url: dbUrl } }),
    globals: buildSharedGlobals(),
    secret: 'test-secret-do-not-use-in-prod',
  })

describe('sqlite schema-drift gate', () => {
  let matchingProd: BasePayload
  let local: BasePayload
  let driftedProd: BasePayload
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-drift-'))

    // `local` is the code-defined schema with an extra `subtitle` column.
    // `matchingProd` has the same schema; `driftedProd` lacks `subtitle`.
    const localConfig = await makeConfig(`file:${join(workDir, 'local.sqlite')}`, [
      { name: 'subtitle', type: 'text' },
    ])
    const matchingConfig = await makeConfig(`file:${join(workDir, 'matching.sqlite')}`, [
      { name: 'subtitle', type: 'text' },
    ])
    const driftedConfig = await makeConfig(`file:${join(workDir, 'drifted.sqlite')}`)

    local = await getPayload({
      config: Promise.resolve(localConfig),
      key: 'switch-env-test-sqlite-drift-local',
    } as Parameters<typeof getPayload>[0])
    matchingProd = await getPayload({
      config: Promise.resolve(matchingConfig),
      key: 'switch-env-test-sqlite-drift-matching',
    } as Parameters<typeof getPayload>[0])
    driftedProd = await getPayload({
      config: Promise.resolve(driftedConfig),
      key: 'switch-env-test-sqlite-drift-drifted',
    } as Parameters<typeof getPayload>[0])
  })

  afterAll(async () => {
    await local?.db.destroy?.()
    await matchingProd?.db.destroy?.()
    await driftedProd?.db.destroy?.()
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  it('reports no drift when the target schema matches the local schema', async () => {
    const drift = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: matchingProd.db,
    })
    expect(drift.statements, JSON.stringify(drift.statements)).toHaveLength(0)
  })

  it('reports drift when the target is missing a column the local schema has', async () => {
    const drift = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: driftedProd.db,
    })
    expect(drift.statements.length).toBeGreaterThan(0)
    expect(drift.statements.join('\n').toLowerCase()).toContain('subtitle')
  })

  it('does not mutate the target database (dry run only)', async () => {
    // Running the diff must not add the missing column to the drifted target.
    await getSqlSchemaDrift({ schemaAdapter: local.db, targetAdapter: driftedProd.db })
    const cols = await (
      driftedProd.db as unknown as {
        client: { execute: (sql: string) => Promise<{ rows: Array<{ name: string }> }> }
      }
    ).client.execute("PRAGMA table_info('posts')")
    expect(cols.rows.some((r) => r.name === 'subtitle')).toBe(false)
  })
})

// In development cloud-storage mode the plugin sets `filenameCompoundIndex` on
// prefixed upload collections, so the live dev schema carries a compound
// unique(filename, prefix) index while production only has single-field
// unique(filename). Without the reshape filter that difference would register as
// drift and permanently block switching back to production on SQL adapters — yet
// no migration can clear it. excludeFilenameIndexReshape removes exactly that
// reshape while leaving genuine user drift intact.
describe('sqlite schema-drift gate: filename compound index reshape', () => {
  let devSchema: BasePayload // compound (filename, prefix) — like development runtime
  let prodDb: BasePayload // single-field filename — like the migration baseline
  let devSchemaWithExtraColumn: BasePayload // compound reshape AND a genuine extra column
  let workDir: string

  const makeUploadConfig = (
    dbUrl: string,
    { compound, extraFields = [] }: { compound: boolean; extraFields?: CollectionConfig['fields'] },
  ) =>
    buildConfig({
      ...sharedConfigDefaults,
      collections: [
        {
          slug: 'media',
          fields: [
            // Mirrors the hidden `prefix` field @payloadcms/plugin-cloud-storage adds.
            { name: 'prefix', type: 'text', admin: { hidden: true } },
            ...extraFields,
          ],
          upload: compound ? { filenameCompoundIndex: ['filename', 'prefix'] } : true,
        },
      ],
      db: sqliteAdapter({ client: { url: dbUrl } }),
      secret: 'test-secret-do-not-use-in-prod',
    })

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-sqlite-reshape-'))
    devSchema = await getPayload({
      config: Promise.resolve(
        await makeUploadConfig(`file:${join(workDir, 'dev.sqlite')}`, { compound: true }),
      ),
      key: 'switch-env-test-reshape-dev',
    } as Parameters<typeof getPayload>[0])
    prodDb = await getPayload({
      config: Promise.resolve(
        await makeUploadConfig(`file:${join(workDir, 'prod.sqlite')}`, { compound: false }),
      ),
      key: 'switch-env-test-reshape-prod',
    } as Parameters<typeof getPayload>[0])
    devSchemaWithExtraColumn = await getPayload({
      config: Promise.resolve(
        await makeUploadConfig(`file:${join(workDir, 'dev-extra.sqlite')}`, {
          compound: true,
          extraFields: [{ name: 'caption', type: 'text' }],
        }),
      ),
      key: 'switch-env-test-reshape-dev-extra',
    } as Parameters<typeof getPayload>[0])
  })

  afterAll(async () => {
    await devSchema?.db.destroy?.()
    await prodDb?.db.destroy?.()
    await devSchemaWithExtraColumn?.db.destroy?.()
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  it('raw drift reports the compound-index reshape against a single-field prod db', async () => {
    const drift = await getSqlSchemaDrift({ schemaAdapter: devSchema.db, targetAdapter: prodDb.db })
    expect(drift.statements.length, JSON.stringify(drift.statements)).toBeGreaterThan(0)
    expect(drift.statements.join('\n')).toContain('media_filename_compound_idx')
  })

  it('excludeFilenameIndexReshape clears the reshape, unblocking the switch', async () => {
    const drift = await getSqlSchemaDrift({ schemaAdapter: devSchema.db, targetAdapter: prodDb.db })
    const filtered = excludeFilenameIndexReshape(drift, ['media'])
    expect(filtered.statements, JSON.stringify(filtered.statements)).toHaveLength(0)
    expect(filtered.hasDataLoss).toBe(false)
  })

  it('is a no-op when no collections were reshaped', async () => {
    const drift = await getSqlSchemaDrift({ schemaAdapter: devSchema.db, targetAdapter: prodDb.db })
    const filtered = excludeFilenameIndexReshape(drift, [])
    expect(filtered.statements).toEqual(drift.statements)
  })

  it('still reports genuine drift alongside the reshape', async () => {
    // The dev schema adds a real `caption` column on top of the reshape; only the
    // reshape should be filtered, leaving the column drift to block the switch.
    const drift = await getSqlSchemaDrift({
      schemaAdapter: devSchemaWithExtraColumn.db,
      targetAdapter: prodDb.db,
    })
    const filtered = excludeFilenameIndexReshape(drift, ['media'])
    expect(filtered.statements.length).toBeGreaterThan(0)
    expect(filtered.statements.join('\n').toLowerCase()).toContain('caption')
    expect(filtered.statements.join('\n')).not.toContain('media_filename_compound_idx')
  })
})

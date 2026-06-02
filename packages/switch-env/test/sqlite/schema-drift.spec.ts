import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getSqlSchemaDrift } from '../../src/lib/db/schemaDrift.js'
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

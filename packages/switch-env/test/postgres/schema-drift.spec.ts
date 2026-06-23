import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { type BasePayload, buildConfig, type CollectionConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  excludeFilenameIndexReshape,
  getSqlSchemaDrift,
  subtractBaselineDrift,
} from '../../src/lib/db/schemaDrift.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'
import { type PostgresTestServer, startPostgres } from './server.js'

// A `number` field with a `defaultValue` maps to a Postgres `numeric` column
// with `DEFAULT <n>` — exactly the shape (Payload's auth `login_attempts`, the
// redirects plugin's `hits`, etc.) that drizzle-kit's `pushSchema` diff reports
// as a no-op `ALTER COLUMN ... SET DEFAULT` on every run, even against a
// database whose schema already matches the code.
const makeConfig = (connectionString: string, extraFields: CollectionConfig['fields'] = []) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: [
      {
        slug: 'widgets',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'score', type: 'number', defaultValue: 0, required: true },
          ...extraFields,
        ],
      },
    ],
    db: postgresAdapter({ pool: { connectionString } }),
    editor: lexicalEditor(),
    secret: 'test-secret-do-not-use-in-prod',
  })

const silencePoolErrors = (adapter: unknown): void => {
  const pool = (adapter as { pool?: { on?: (event: string, cb: () => void) => void } }).pool
  pool?.on?.('error', () => {})
}

describe('postgres schema-drift gate: numeric-default false positive', () => {
  let server: PostgresTestServer
  let local: BasePayload // code schema, pushed
  let matchingProd: BasePayload // identical schema (in sync with code)
  let driftedProd: BasePayload // genuinely missing an extra column

  beforeAll(async () => {
    server = await startPostgres()
    await server.createDatabase('local')
    await server.createDatabase('matching')
    await server.createDatabase('drifted')

    local = await getPayload({
      config: Promise.resolve(
        await makeConfig(server.connectionString('local'), [{ name: 'caption', type: 'text' }]),
      ),
      key: 'switch-env-test-pg-drift-local',
    } as Parameters<typeof getPayload>[0])
    matchingProd = await getPayload({
      config: Promise.resolve(
        await makeConfig(server.connectionString('matching'), [{ name: 'caption', type: 'text' }]),
      ),
      key: 'switch-env-test-pg-drift-matching',
    } as Parameters<typeof getPayload>[0])
    // drifted prod lacks the `caption` column the code has.
    driftedProd = await getPayload({
      config: Promise.resolve(await makeConfig(server.connectionString('drifted'))),
      key: 'switch-env-test-pg-drift-drifted',
    } as Parameters<typeof getPayload>[0])

    silencePoolErrors(local.db)
    silencePoolErrors(matchingProd.db)
    silencePoolErrors(driftedProd.db)
  })

  afterAll(async () => {
    await local?.db.destroy?.()
    await matchingProd?.db.destroy?.()
    await driftedProd?.db.destroy?.()
    await server?.stop()
  })

  it('reproduces the no-op SET DEFAULT artifact against an in-sync prod db', async () => {
    // The matching prod db has byte-identical schema, yet drizzle-kit still emits
    // a numeric SET DEFAULT statement — the false positive this fix targets.
    const drift = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: matchingProd.db,
    })
    const joined = drift.statements.join('\n').toLowerCase()
    expect(joined, JSON.stringify(drift.statements)).toContain('set default')
    expect(joined).toContain('score')
  })

  it('the same artifact appears in the dev self-baseline', async () => {
    const baseline = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: local.db,
    })
    expect(baseline.statements.join('\n').toLowerCase()).toContain('set default')
  })

  it('subtractBaselineDrift clears the artifact, unblocking the switch', async () => {
    const prodDrift = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: matchingProd.db,
    })
    const baseline = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: local.db,
    })
    const drift = subtractBaselineDrift(prodDrift, baseline.statements)
    expect(drift.statements, JSON.stringify(drift.statements)).toHaveLength(0)
    expect(drift.hasDataLoss).toBe(false)
  })

  it('still blocks on genuine drift the baseline does not explain', async () => {
    // drifted prod is missing `caption`; the numeric-default noise is shared, but
    // the ADD COLUMN is unique to prod and must survive the subtraction.
    const prodDrift = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: driftedProd.db,
    })
    const baseline = await getSqlSchemaDrift({
      schemaAdapter: local.db,
      targetAdapter: local.db,
    })
    const drift = excludeFilenameIndexReshape(
      subtractBaselineDrift(prodDrift, baseline.statements),
      [],
    )
    expect(drift.statements.length).toBeGreaterThan(0)
    expect(drift.statements.join('\n').toLowerCase()).toContain('caption')
    // The numeric-default noise must NOT remain — only the genuine column drift.
    expect(drift.statements.join('\n').toLowerCase()).not.toContain('set default')
  })
})

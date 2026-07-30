import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { captureSchemaPrivileges } from '../../src/lib/db/postgresDdl.js'
import { type PgTestClient, type PostgresTestServer, startPostgres } from './server.js'

/**
 * `captureSchemaPrivileges` runs against the RESTORE TARGET before
 * `restorePostgres` drops its schema, so every ACL shape a target can be in has
 * to survive it. The shape that used to crash the copy with
 * `22023 ACL arrays must be one-dimensional` is a null `nspacl` — the default
 * state of any plainly created schema, i.e. the ordinary case of copying
 * production down to a local database.
 */
describe('captureSchemaPrivileges: ACL shapes on the restore target', () => {
  let server: PostgresTestServer
  let client: PgTestClient

  beforeAll(async () => {
    server = await startPostgres()
    await server.createDatabase('privileges')
    client = await server.connectClient('privileges')
  })

  afterAll(async () => {
    await client?.end()
    await server?.stop()
  })

  const freshSchema = async (name: string) => {
    await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)
    await client.query(`CREATE SCHEMA "${name}"`)
  }

  const aclShape = async (name: string) => {
    const result = await client.query(
      `SELECT nspacl IS NULL AS is_null, cardinality(nspacl) AS card
       FROM pg_namespace WHERE nspname = $1`,
      [name],
    )
    return result.rows[0]
  }

  it('returns no statements for a schema with only owner-default privileges (null ACL)', async () => {
    await freshSchema('acl_null')

    // Guards the premise: a plainly created schema really does carry a null ACL,
    // which is what made this the default path rather than an edge case.
    expect(await aclShape('acl_null')).toMatchObject({ card: null, is_null: true })
    await expect(captureSchemaPrivileges(client, 'acl_null')).resolves.toEqual([])
  })

  it('returns no statements for a schema whose grants were all revoked (empty ACL)', async () => {
    await freshSchema('acl_empty')
    // Granting materializes the ACL (including the owner's implicit entry);
    // revoking every grant back off leaves an explicit-but-empty `'{}'` — a
    // one-dimensional zero-element array, unlike an empty array built in SQL.
    await client.query('GRANT USAGE ON SCHEMA "acl_empty" TO PUBLIC')
    await client.query('REVOKE ALL ON SCHEMA "acl_empty" FROM PUBLIC')
    await client.query('REVOKE ALL ON SCHEMA "acl_empty" FROM CURRENT_USER')

    expect(await aclShape('acl_empty')).toMatchObject({ card: 0, is_null: false })
    await expect(captureSchemaPrivileges(client, 'acl_empty')).resolves.toEqual([])
  })

  it('captures a populated schema ACL as replayable GRANTs', async () => {
    await freshSchema('acl_granted')
    await client.query('DROP ROLE IF EXISTS acl_reader')
    await client.query('CREATE ROLE acl_reader')
    await client.query('GRANT USAGE ON SCHEMA "acl_granted" TO acl_reader')
    await client.query('GRANT USAGE ON SCHEMA "acl_granted" TO PUBLIC')

    const statements = await captureSchemaPrivileges(client, 'acl_granted')

    expect(statements).toContain('GRANT USAGE ON SCHEMA "acl_granted" TO "acl_reader"')
    // grantee = 0 (the PUBLIC pseudo-role) must render as the PUBLIC keyword,
    // never as a quoted identifier.
    expect(statements).toContain('GRANT USAGE ON SCHEMA "acl_granted" TO PUBLIC')
  })

  it('captures default privileges, and the capture replays onto a rebuilt schema', async () => {
    await freshSchema('acl_defaults')
    await client.query('DROP ROLE IF EXISTS acl_api')
    await client.query('CREATE ROLE acl_api')
    await client.query('GRANT USAGE ON SCHEMA "acl_defaults" TO acl_api')
    await client.query(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA "acl_defaults" GRANT SELECT, INSERT ON TABLES TO acl_api',
    )

    const statements = await captureSchemaPrivileges(client, 'acl_defaults')
    expect(statements.some((statement) => statement.includes('ALTER DEFAULT PRIVILEGES'))).toBe(
      true,
    )

    // The point of the capture: rebuilding the schema the way restorePostgres
    // does discards the grants, and replaying restores them exactly — so a
    // second copy into the same target sees the same ACL as the first.
    await freshSchema('acl_defaults')
    expect(await captureSchemaPrivileges(client, 'acl_defaults')).toEqual([])
    for (const statement of statements) {
      await client.query(statement)
    }

    expect(await captureSchemaPrivileges(client, 'acl_defaults')).toEqual(statements)
  })
})

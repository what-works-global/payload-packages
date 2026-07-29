import { describe, expect, it } from 'vitest'

import type { RestoreSqlResult } from '../src/lib/db/sql.js'

import { describeRestoreResult } from '../src/lib/utils.js'

const result = (over: Partial<RestoreSqlResult> = {}): RestoreSqlResult => ({
  deferredReconcile: [],
  migrationsChecked: true,
  pendingMigrations: [],
  schemaMode: 'migration-managed',
  unresolvedDrift: [],
  ...over,
})

describe('describeRestoreResult', () => {
  it('reports a clean migration-managed copy with no caveat', () => {
    expect(describeRestoreResult(result())).toEqual({ detail: null, incomplete: false })
  })

  it('flags a failed migration on a migration-managed target as incomplete', () => {
    const { detail, incomplete } = describeRestoreResult(
      result({ migrationError: 'does not provide an export named MigrateDownArgs' }),
    )
    expect(incomplete).toBe(true)
    expect(detail).toContain('MigrateDownArgs')
    expect(detail).toContain('payload migrate')
  })

  it('does not flag a failed migration on a push-managed target', () => {
    // The dev push that follows reconciles the schema — this is the ordinary
    // local-development path and must not nag.
    const { incomplete } = describeRestoreResult(
      result({ migrationError: 'boom', migrationsChecked: false, schemaMode: 'push-managed' }),
    )
    expect(incomplete).toBe(false)
  })

  it('flags unrecorded migration files as incomplete and names them', () => {
    const { detail, incomplete } = describeRestoreResult(
      result({ pendingMigrations: ['20260101_000000_add_slug'] }),
    )
    expect(incomplete).toBe(true)
    expect(detail).toContain('20260101_000000_add_slug')
  })

  it('does not flag a copy on read-only drift alone', () => {
    // Drizzle-kit re-emits no-op statements (numeric defaults) against a
    // perfectly in-sync database, and this mode has no baseline to subtract
    // them with — so drift is detail, never the trigger.
    expect(
      describeRestoreResult(
        result({
          unresolvedDrift: ['ALTER TABLE "users" ALTER COLUMN "login_attempts" SET DEFAULT 0'],
        }),
      ),
    ).toEqual({ detail: null, incomplete: false })
  })

  it('includes the drift detail once something else is wrong', () => {
    const { detail } = describeRestoreResult(
      result({
        pendingMigrations: ['20260101_000000_add_slug'],
        unresolvedDrift: ['ALTER TABLE "posts" ADD COLUMN "slug" text'],
      }),
    )
    expect(detail).toContain('ADD COLUMN "slug"')
  })

  it('tells a migration-managed target to migrate rather than restart the dev server', () => {
    const { detail, incomplete } = describeRestoreResult(
      result({ deferredReconcile: ['table "posts": removed columns [title] vs added [heading]'] }),
    )
    expect(incomplete).toBe(true)
    expect(detail).toContain('payload migrate')
    expect(detail).not.toContain('Restart the dev server')
  })
})

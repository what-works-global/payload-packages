import type { BasePayload, DatabaseAdapter } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { runPendingMigrations } from '../src/lib/db/sqlShared.js'

const alwaysExists = () => true

const makeAdapter = (over: Partial<Record<string, unknown>>): DatabaseAdapter =>
  ({ migrationDir: '/tmp/migrations', ...over }) as unknown as DatabaseAdapter

describe('runPendingMigrations', () => {
  it('runs migrate when a migration dir is present', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    const outcome = await runPendingMigrations({
      migrationDirExists: alwaysExists,
      migrationManaged: false,
      targetAdapter: makeAdapter({ migrate }),
    })
    expect(migrate).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ status: 'applied' })
  })

  it('skips migrate when the migration dir does not exist', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    const outcome = await runPendingMigrations({
      migrationDirExists: () => false,
      migrationManaged: false,
      targetAdapter: makeAdapter({ migrate }),
    })
    expect(migrate).not.toHaveBeenCalled()
    expect(outcome).toEqual({ reason: 'no-migration-dir', status: 'skipped' })
  })

  it('skips when the adapter has no migrationDir', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    const outcome = await runPendingMigrations({
      migrationDirExists: alwaysExists,
      migrationManaged: false,
      targetAdapter: makeAdapter({ migrate, migrationDir: undefined }),
    })
    expect(migrate).not.toHaveBeenCalled()
    expect(outcome).toEqual({ reason: 'no-migration-dir', status: 'skipped' })
  })

  it('reports a migrate failure and warns instead of aborting the copy', async () => {
    // Mirrors the real failure: reading on-disk `.ts` migration files fails
    // because they import types as values (`MigrateDownArgs`), which the runtime
    // ESM loader cannot resolve. The copy must not abort over this.
    const error = new SyntaxError(
      "The requested module '@payloadcms/db-postgres' does not provide an export named 'MigrateDownArgs'",
    )
    const migrate = vi.fn().mockRejectedValue(error)
    const warn = vi.fn()

    const outcome = await runPendingMigrations({
      logger: { warn } as unknown as BasePayload['logger'],
      migrationDirExists: alwaysExists,
      migrationManaged: false,
      targetAdapter: makeAdapter({ migrate }),
    })

    expect(migrate).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ error, status: 'failed' })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatchObject({ err: error })
    // Push-managed wording: the push that follows still reconciles the schema.
    expect(warn.mock.calls[0][1]).toContain('dev schema push instead')
  })

  it('tells a migration-managed caller that nothing was pushed in their place', async () => {
    const migrate = vi.fn().mockRejectedValue(new Error('backfill blew up'))
    const warn = vi.fn()

    const outcome = await runPendingMigrations({
      logger: { warn } as unknown as BasePayload['logger'],
      migrationDirExists: alwaysExists,
      migrationManaged: true,
      targetAdapter: makeAdapter({ migrate }),
    })

    expect(outcome.status).toBe('failed')
    expect(warn.mock.calls[0][1]).toContain('NO schema push was run in their place')
  })

  it('does not throw on a migrate failure even without a logger', async () => {
    const migrate = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      runPendingMigrations({
        migrationDirExists: alwaysExists,
        migrationManaged: false,
        targetAdapter: makeAdapter({ migrate }),
      }),
    ).resolves.toEqual({ error: new Error('boom'), status: 'failed' })
  })
})

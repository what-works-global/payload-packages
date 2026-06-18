import type { BasePayload, DatabaseAdapter } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { runPendingMigrations } from '../src/lib/db/sqlShared.js'

const alwaysExists = () => true

const makeAdapter = (over: Partial<Record<string, unknown>>): DatabaseAdapter =>
  ({ migrationDir: '/tmp/migrations', ...over }) as unknown as DatabaseAdapter

describe('runPendingMigrations', () => {
  it('runs migrate when a migration dir is present', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    await runPendingMigrations(makeAdapter({ migrate }), alwaysExists)
    expect(migrate).toHaveBeenCalledOnce()
  })

  it('skips migrate when the migration dir does not exist', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    await runPendingMigrations(makeAdapter({ migrate }), () => false)
    expect(migrate).not.toHaveBeenCalled()
  })

  it('skips when the adapter has no migrationDir', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    await runPendingMigrations(makeAdapter({ migrate, migrationDir: undefined }), alwaysExists)
    expect(migrate).not.toHaveBeenCalled()
  })

  it('swallows a migrate failure and warns instead of aborting the copy', async () => {
    // Mirrors the real failure: reading on-disk `.ts` migration files fails
    // because they import types as values (`MigrateDownArgs`), which the runtime
    // ESM loader cannot resolve. The copy must not abort over this.
    const error = new SyntaxError(
      "The requested module '@payloadcms/db-postgres' does not provide an export named 'MigrateDownArgs'",
    )
    const migrate = vi.fn().mockRejectedValue(error)
    const warn = vi.fn()

    await expect(
      runPendingMigrations(makeAdapter({ migrate }), alwaysExists, {
        warn,
      } as unknown as BasePayload['logger']),
    ).resolves.toBeUndefined()

    expect(migrate).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatchObject({ err: error })
  })

  it('does not throw on a migrate failure even without a logger', async () => {
    const migrate = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      runPendingMigrations(makeAdapter({ migrate }), alwaysExists),
    ).resolves.toBeUndefined()
  })
})

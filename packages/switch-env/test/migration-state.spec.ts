import type { DatabaseAdapter } from 'payload'

import { afterEach, describe, expect, it } from 'vitest'

import {
  findUnappliedMigrations,
  hasDevPushMarker,
  isMigrationManagedTarget,
  listMigrationFileNames,
} from '../src/lib/db/migrationState.js'

const adapter = (push?: boolean): DatabaseAdapter => ({ push }) as unknown as DatabaseAdapter

// `process.env.NODE_ENV` is typed readonly once Next's types are in scope.
const setNodeEnv = (value: string | undefined): void => {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

describe('isMigrationManagedTarget', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalMigrating = process.env.PAYLOAD_MIGRATING

  afterEach(() => {
    setNodeEnv(originalNodeEnv)
    process.env.PAYLOAD_MIGRATING = originalMigrating
  })

  // The gate must stay the exact inverse of the one in every Drizzle adapter's
  // connect() — this plugin's applyDevSchema is a reimplementation of the push
  // that gate protects, so it may only run where Payload itself would push.
  it('treats a push:false target as migration-managed regardless of NODE_ENV', () => {
    setNodeEnv('development')
    expect(isMigrationManagedTarget(adapter(false))).toBe(true)
  })

  it('treats a hosted (NODE_ENV=production) target as migration-managed', () => {
    setNodeEnv('production')
    delete process.env.PAYLOAD_MIGRATING
    // This is the orgtracker staging shape: Vercel sets NODE_ENV=production for
    // every environment, and the adapter carries no explicit `push`.
    expect(isMigrationManagedTarget(adapter(undefined))).toBe(true)
    expect(isMigrationManagedTarget(adapter(true))).toBe(true)
  })

  it('treats a local development target as push-managed', () => {
    setNodeEnv('development')
    delete process.env.PAYLOAD_MIGRATING
    expect(isMigrationManagedTarget(adapter(undefined))).toBe(false)
    expect(isMigrationManagedTarget(adapter(true))).toBe(false)
  })

  it('treats a target under `payload migrate` as migration-managed', () => {
    setNodeEnv('development')
    process.env.PAYLOAD_MIGRATING = 'true'
    expect(isMigrationManagedTarget(adapter(undefined))).toBe(true)
  })
})

describe('hasDevPushMarker', () => {
  it('detects the batch = -1 row however the driver typed it', () => {
    expect(hasDevPushMarker([{ name: 'dev', batch: -1 }])).toBe(true)
    // Postgres bigint/numeric columns come back as strings on some drivers.
    expect(hasDevPushMarker([{ name: 'dev', batch: '-1' }])).toBe(true)
    expect(hasDevPushMarker([{ name: '20260101_000000_init', batch: 1 }])).toBe(false)
    expect(hasDevPushMarker([])).toBe(false)
  })
})

describe('listMigrationFileNames', () => {
  it('mirrors readMigrationFiles: .ts/.js, no index, name up to the first dot', () => {
    const files = [
      '20260101_000000_init.ts',
      '20260102_000000_add_column.js',
      'index.ts',
      'index.js',
      'README.md',
      '.DS_Store',
      'types.d.ts',
    ]
    expect(listMigrationFileNames('/migrations', () => files)).toEqual([
      '20260101_000000_init',
      '20260102_000000_add_column',
    ])
  })

  it('dedupes a migration shipped as both source and build output', () => {
    const files = ['20260101_000000_init.ts', '20260101_000000_init.js']
    expect(listMigrationFileNames('/migrations', () => files)).toEqual(['20260101_000000_init'])
  })
})

describe('findUnappliedMigrations', () => {
  it('returns on-disk migrations with no recorded row', () => {
    expect(findUnappliedMigrations(['a', 'b', 'c'], ['a', 'dev', 'c'])).toEqual(['b'])
    expect(findUnappliedMigrations(['a'], ['a'])).toEqual([])
    expect(findUnappliedMigrations([], ['a'])).toEqual([])
  })
})

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, type SanitizedConfig } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { switchEnvPlugin } from '../src/index.js'
import { setEnvCache } from '../src/lib/env.js'
import { sharedConfigDefaults } from './shared/configDefaults.js'

// The compound `(filename, prefix)` index is a development cloud-storage runtime
// reshape, not part of the schema migrations describe. While `payload
// migrate:create` builds the config to diff the schema, the plugin must NOT
// declare it — otherwise the generated migration drops the single-field unique
// `filename` index and adds the compound one, and that migration runs against
// production. buildConfig never connects, so these assertions are pure config
// shape — no database needed.
const buildUploadConfig = (): Promise<SanitizedConfig> =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: [
      {
        slug: 'privateMedia',
        fields: [
          { name: 'prefix', type: 'text', admin: { hidden: true }, defaultValue: 'private' },
        ],
        upload: true,
      },
    ],
    db: sqliteAdapter({ client: { url: 'file::memory:' } }),
    plugins: [
      switchEnvPlugin({
        db: {
          developmentArgs: { client: { url: 'file::memory:' } },
          function: sqliteAdapter,
          productionArgs: { client: { url: 'file::memory:' } },
        },
        developmentFileStorage: {
          collections: { privateMedia: { prefix: 'private' } },
          mode: 'cloud-storage',
          prefix: 'staging',
        },
        developmentSafetyMode: false,
        payloadVersion: '3.84.1',
      }),
    ],
    secret: 'test-secret-do-not-use-in-prod',
  })

const getUploadCollection = (config: SanitizedConfig) =>
  config.collections.find((collection) => collection.slug === 'privateMedia')

const compoundIndex = (config: SanitizedConfig) =>
  getUploadCollection(config)?.upload?.filenameCompoundIndex

const hasCreatedDuringDevelopmentField = (config: SanitizedConfig) =>
  getUploadCollection(config)?.fields.some(
    (field) => 'name' in field && field.name === 'createdDuringDevelopment',
  )

describe('filenameCompoundIndex and migration generation', () => {
  const originalArgv = process.argv

  beforeEach(() => {
    setEnvCache('development')
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it('declares the compound index at runtime (no migrate command in argv)', async () => {
    process.argv = ['node', '/path/to/next', 'start']
    const config = await buildUploadConfig()
    expect(compoundIndex(config)).toEqual(['filename', 'prefix'])
  })

  it('omits the compound index while payload generates a migration', async () => {
    process.argv = ['node', '/path/to/payload', 'migrate:create']
    const config = await buildUploadConfig()
    expect(compoundIndex(config)).toBeUndefined()
  })

  it('omits the compound index for the migrate apply command too', async () => {
    process.argv = ['node', '/path/to/payload', 'migrate']
    const config = await buildUploadConfig()
    expect(compoundIndex(config)).toBeUndefined()
  })

  it('still adds the development-tracking upload fields during migration generation', async () => {
    // The suppression is surgical: only the compound index is withheld, never
    // the createdDuringDevelopment / storage-mode fields — those belong in the
    // baseline schema migrations describe.
    process.argv = ['node', '/path/to/payload', 'migrate:create']
    const config = await buildUploadConfig()
    expect(hasCreatedDuringDevelopmentField(config)).toBe(true)
  })
})

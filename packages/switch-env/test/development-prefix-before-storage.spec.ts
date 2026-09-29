import type { CollectionConfig, Config, DatabaseAdapterObj, Plugin } from 'payload'

import { s3Storage } from '@payloadcms/storage-s3'
import { describe, expect, it } from 'vitest'

import type { SwitchEnvPluginArgs } from '../src/types.js'

import { switchEnvPlugin } from '../src/index.js'
import {
  applyDevelopmentPrefixesBeforeStoragePlugin,
  confirmDevelopmentPrefixesAppliedBeforeStoragePlugin,
} from '../src/lib/developmentPrefix.js'

// In `copy` mode the environment is always development, so switch-env gives the
// storage collection options their development prefix when `switchEnvPlugin({...})`
// is called — while the plugins array is being built — before buildConfig applies
// the storage plugin, which reads its options only then. The storage plugin then
// records `staging/public` as the collection prefix itself.

const stubDatabaseAdapter = (): DatabaseAdapterObj =>
  ({ defaultIDType: 'text', init: () => ({}) as never }) as unknown as DatabaseAdapterObj

const makeStorageCollections = () => ({ media: { prefix: 'public' } })

const makeSwitchEnvPlugin = (
  collections: ReturnType<typeof makeStorageCollections>,
  args: Partial<SwitchEnvPluginArgs<{ url: string }>> = {},
) =>
  switchEnvPlugin({
    buttonMode: 'copy',
    db: {
      developmentArgs: { url: 'mongodb://127.0.0.1/development' },
      function: stubDatabaseAdapter,
      productionArgs: { url: 'mongodb://127.0.0.1/production' },
    },
    developmentFileStorage: { collections, mode: 'cloud-storage', prefix: 'staging' },
    developmentSafetyMode: false,
    ...args,
  })

const makeS3Storage = (collections: ReturnType<typeof makeStorageCollections>) =>
  s3Storage({ bucket: 'test-bucket', collections, config: { region: 'ap-southeast-2' } })

/** What buildConfig does with the plugins array: apply each plugin in order. */
const applyPlugins = async (plugins: Plugin[]) => {
  let config = {
    collections: [{ slug: 'media', fields: [], upload: true }],
    endpoints: [],
    globals: [],
  } as unknown as Config
  for (const plugin of plugins) {
    config = await plugin(config)
  }
  return config
}

const prefixFieldDefault = (collections: CollectionConfig[] | undefined) => {
  const prefixField = collections
    ?.find((collection) => collection.slug === 'media')
    ?.fields.find((field) => 'name' in field && field.name === 'prefix')
  return prefixField && 'defaultValue' in prefixField ? prefixField.defaultValue : undefined
}

describe('development prefix applied before the storage plugin', () => {
  it('rewrites the storage options as soon as switchEnvPlugin() is called in copy mode', () => {
    const collections = makeStorageCollections()
    makeSwitchEnvPlugin(collections)
    expect(collections.media.prefix).toBe('staging/public')
  })

  it('is idempotent across repeated calls with the same options object', () => {
    const collections = makeStorageCollections()
    makeSwitchEnvPlugin(collections)
    makeSwitchEnvPlugin(collections)
    expect(collections.media.prefix).toBe('staging/public')
  })

  it('leaves the options alone in switch mode and when the plugin is disabled', () => {
    const switchMode = makeStorageCollections()
    makeSwitchEnvPlugin(switchMode, { buttonMode: 'switch' })
    expect(switchMode.media.prefix).toBe('public')

    const disabled = makeStorageCollections()
    makeSwitchEnvPlugin(disabled, { enable: false })
    expect(disabled.media.prefix).toBe('public')
  })

  it('reaches the storage plugin listed before switch-env, and is kept', async () => {
    const collections = makeStorageCollections()
    // Same shape as a site's plugins array: storage plugin second last, switch-env last.
    const config = await applyPlugins([
      makeS3Storage(collections),
      makeSwitchEnvPlugin(collections),
    ])
    expect(prefixFieldDefault(config.collections)).toBe('staging/public')
    expect(collections.media.prefix).toBe('staging/public')
  })

  it('restores the configured prefix when the storage plugin did not record it', () => {
    const developmentFileStorage = {
      collections: makeStorageCollections(),
      mode: 'cloud-storage' as const,
      prefix: 'staging',
    }
    applyDevelopmentPrefixesBeforeStoragePlugin(developmentFileStorage)
    expect(developmentFileStorage.collections.media.prefix).toBe('staging/public')

    // The storage plugin read a separate options object, so it recorded `public`.
    const collections: CollectionConfig[] = [
      {
        slug: 'media',
        fields: [{ name: 'prefix', type: 'text', defaultValue: 'public' }],
        upload: true,
      },
    ]
    expect(
      confirmDevelopmentPrefixesAppliedBeforeStoragePlugin(collections, developmentFileStorage),
    ).toEqual(['media'])
    expect(developmentFileStorage.collections.media.prefix).toBe('public')
  })
})

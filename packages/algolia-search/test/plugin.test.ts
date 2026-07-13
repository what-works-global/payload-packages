import type { CollectionConfig, Config, Endpoint } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import type { AlgoliaSearchContext, AlgoliaSearchPluginConfig } from '../src/index.js'

import {
  algoliaSearchPlugin,
  defaultReindexPath,
  pluginKey,
  reindexActionPath,
} from '../src/index.js'

const baseConfig = (): Config =>
  ({
    admin: { user: 'users' },
    collections: [
      { slug: 'users', auth: true, fields: [] },
      {
        slug: 'pages',
        fields: [{ name: 'title', type: 'text' }],
        hooks: { afterChange: [vi.fn()] },
        versions: { drafts: true },
      },
      { slug: 'tags', fields: [] },
    ],
  }) as unknown as Config

const pluginConfig = (
  overrides: Partial<AlgoliaSearchPluginConfig> = {},
): AlgoliaSearchPluginConfig => ({
  algolia: { apiKey: 'key', appId: 'app', index: 'idx' },
  collections: { pages: true },
  ...overrides,
})

const getCollection = (config: Config, slug: string): CollectionConfig => {
  const collection = config.collections?.find((entry) => entry.slug === slug)
  if (!collection) {
    throw new Error(`missing collection ${slug}`)
  }
  return collection
}

describe('algoliaSearchPlugin', () => {
  it('appends hooks to configured collections only, preserving existing hooks', () => {
    const result = algoliaSearchPlugin(pluginConfig())(baseConfig()) as Config
    const pages = getCollection(result, 'pages')
    expect(pages.hooks?.afterChange).toHaveLength(2)
    expect(pages.hooks?.afterDelete).toHaveLength(1)
    expect(getCollection(result, 'tags').hooks).toBeUndefined()
  })

  it('registers the endpoint and the header action with clientProps', () => {
    const result = algoliaSearchPlugin(pluginConfig())(baseConfig()) as Config

    const endpoint = (result.endpoints as Endpoint[]).find(
      (entry) => entry.path === defaultReindexPath,
    )
    expect(endpoint?.method).toBe('post')

    const action = result.admin?.components?.actions?.[0] as {
      clientProps: Record<string, unknown>
      path: string
    }
    expect(action.path).toBe(reindexActionPath)
    expect(action.clientProps).toEqual({
      collections: ['pages'],
      reindexPath: defaultReindexPath,
    })

    // collections themselves carry no admin components
    expect(getCollection(result, 'pages').admin?.components).toBeUndefined()
  })

  it('stores the resolved context on config.custom and merges index settings safely', () => {
    const result = algoliaSearchPlugin(
      pluginConfig({
        indexSettings: { attributesForFaceting: ['filterOnly(section)'] },
      }),
    )(baseConfig()) as Config
    const context = (result.custom as Record<string, AlgoliaSearchContext>)[pluginKey]
    expect(context.configured).toBe(true)
    expect(context.indexName).toBe('idx')
    // the collection facet survives an override — per-collection reindex depends on it
    expect(
      (context.indexSettings as { attributesForFaceting: string[] }).attributesForFaceting,
    ).toEqual(['filterOnly(section)', 'filterOnly(collection)'])
  })

  it('reindex: false removes the endpoint and the header action', () => {
    const result = algoliaSearchPlugin(pluginConfig({ reindex: false }))(baseConfig()) as Config
    expect(result.endpoints ?? []).toHaveLength(0)
    expect(result.admin?.components?.actions).toBeUndefined()
  })

  it('reindex.button: false keeps the endpoint but hides the header action', () => {
    const result = algoliaSearchPlugin(pluginConfig({ reindex: { button: false } }))(
      baseConfig(),
    ) as Config
    expect(result.endpoints).toHaveLength(1)
    expect(result.admin?.components?.actions).toBeUndefined()
  })

  it('enabled: false returns the config untouched', () => {
    const incoming = baseConfig()
    const result = algoliaSearchPlugin(pluginConfig({ enabled: false }))(incoming) as Config
    expect(result.collections).toBe(incoming.collections)
    expect(result.endpoints).toBeUndefined()
    expect(result.custom).toBeUndefined()
  })

  it('missing credentials warn but keep everything registered (importMap stability)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = algoliaSearchPlugin(
        pluginConfig({ algolia: { apiKey: '', appId: '', index: '' } }),
      )(baseConfig()) as Config
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing algolia.appId'))
      const context = (result.custom as Record<string, AlgoliaSearchContext>)[pluginKey]
      expect(context.configured).toBe(false)
      expect(getCollection(result, 'pages').hooks?.afterChange).toHaveLength(2)
      expect(result.admin?.components?.actions).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('warns about configured collections that do not exist', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      algoliaSearchPlugin(pluginConfig({ collections: { ghosts: true } }))(baseConfig()) as Config
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ghosts"'))
    } finally {
      warn.mockRestore()
    }
  })
})

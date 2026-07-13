import type { SanitizedCollectionConfig } from 'payload'

import { vi } from 'vitest'

import type { AlgoliaClient, AlgoliaSearchContext } from '../src/index.js'

import {
  createRichTextToText,
  defaultExcludeFields,
  defaultIndexSettings,
  defaultReindexPath,
} from '../src/index.js'

/** Mocked Algolia v5 client covering every method the plugin calls. */
export const makeClient = () => ({
  deleteBy: vi.fn((_args: unknown) => Promise.resolve({})),
  deleteObject: vi.fn((_args: unknown) => Promise.resolve({})),
  replaceAllObjects: vi.fn((_args: unknown) => Promise.resolve({})),
  saveObject: vi.fn((_args: unknown) => Promise.resolve({})),
  saveObjects: vi.fn((_args: unknown) => Promise.resolve([])),
  setSettings: vi.fn((_args: unknown) => Promise.resolve({})),
})

export type MockClient = ReturnType<typeof makeClient>

export const makeContext = (
  overrides: Partial<AlgoliaSearchContext> = {},
): AlgoliaSearchContext => ({
  awaitSync: true,
  collections: { news: {}, pages: {} },
  configured: true,
  contentLimit: 4000,
  excludeFields: defaultExcludeFields,
  getClient: () => {
    throw new Error('this test does not expect Algolia calls')
  },
  indexName: 'test-index',
  indexSettings: defaultIndexSettings,
  reindex: {
    access: ({ req }) => Boolean(req.user),
    batchSize: 100,
    depth: 0,
    endpointEnabled: true,
    path: defaultReindexPath,
  },
  richTextToText: createRichTextToText(),
  ...overrides,
})

export const withClient = (
  client: MockClient,
  overrides: Partial<AlgoliaSearchContext> = {},
): AlgoliaSearchContext =>
  makeContext({ getClient: () => client as unknown as AlgoliaClient, ...overrides })

export const pagesCollection = {
  slug: 'pages',
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'slug', type: 'text' },
    { name: 'body', type: 'textarea' },
  ],
  versions: { drafts: { autosave: true } },
} as unknown as SanitizedCollectionConfig

export const tagsCollection = {
  slug: 'tags',
  admin: { useAsTitle: 'name' },
  fields: [{ name: 'name', type: 'text' }],
  versions: false,
} as unknown as SanitizedCollectionConfig

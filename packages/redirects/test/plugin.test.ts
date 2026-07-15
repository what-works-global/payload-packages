import type {
  CollectionConfig,
  Config,
  Field,
  PayloadRequest,
  RadioField,
  RelationshipField,
} from 'payload'

import { describe, expect, it, vi } from 'vitest'

import type { RedirectsPluginConfig } from '../src/index.js'

import { memoryCache } from '../src/exports/cache.js'
import {
  buildRedirectsCacheEntries,
  getRedirectsConfig,
  redirectsPlugin,
  validateFromField,
  validateScrollTo,
  validateUrlOrPathname,
} from '../src/index.js'

const baseConfig = (): Config =>
  ({
    collections: [
      {
        slug: 'pages',
        fields: [{ name: 'slug', type: 'text' }],
        versions: { drafts: true },
      },
      { slug: 'posts', fields: [{ name: 'slug', type: 'text' }] },
    ],
  }) as unknown as Config

const pluginConfig = (overrides: Partial<RedirectsPluginConfig> = {}): RedirectsPluginConfig => ({
  cache: memoryCache(),
  collections: {
    pages: { path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`) },
  },
  ...overrides,
})

const getCollection = (config: Config, slug: string): CollectionConfig => {
  const collection = config.collections?.find((candidate) => candidate.slug === slug)
  if (!collection) {
    throw new Error(`Collection ${slug} missing`)
  }
  return collection
}

const fieldByName = (fields: Field[], name: string): Field | undefined =>
  fields.find((field) => 'name' in field && field.name === name)

const makeReq = (config: Config, payloadOverrides: Record<string, unknown> = {}): PayloadRequest =>
  ({
    payload: {
      config,
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      ...payloadOverrides,
    },
  }) as unknown as PayloadRequest

describe('redirectsPlugin config shaping', () => {
  it('registers the redirects collection with reference fields when destinations are configured', async () => {
    const result = await redirectsPlugin(pluginConfig())(baseConfig())
    const redirects = getCollection(result, 'redirects')

    expect(redirects.orderable).toBe(true)
    expect(redirects.admin?.useAsTitle).toBe('from')

    const toGroup = fieldByName(redirects.fields, 'to')
    if (!toGroup || toGroup.type !== 'group') {
      throw new Error('to group missing')
    }
    const radio = fieldByName(toGroup.fields, 'type') as RadioField
    expect(radio.type).toBe('radio')
    const reference = fieldByName(toGroup.fields, 'reference') as RelationshipField
    expect(reference.relationTo).toEqual(['pages'])
    expect(fieldByName(toGroup.fields, 'url')).toBeDefined()
    expect(fieldByName(toGroup.fields, 'scrollTo')).toBeDefined()

    expect(fieldByName(redirects.fields, 'hits')).toBeDefined()
    expect(fieldByName(redirects.fields, 'lastAccess')).toBeDefined()

    expect(getRedirectsConfig(result).slug).toBe('redirects')
  })

  it('omits the reference picker without destination collections', async () => {
    const result = await redirectsPlugin(pluginConfig({ collections: undefined }))(baseConfig())
    const toGroup = fieldByName(getCollection(result, 'redirects').fields, 'to')
    if (!toGroup || toGroup.type !== 'group') {
      throw new Error('to group missing')
    }
    expect(fieldByName(toGroup.fields, 'type')).toBeUndefined()
    expect(fieldByName(toGroup.fields, 'reference')).toBeUndefined()
    expect(fieldByName(toGroup.fields, 'url')).toBeDefined()
  })

  it('drops hit tracking with hits: false', async () => {
    const result = await redirectsPlugin(pluginConfig({ hits: false }))(baseConfig())
    const redirects = getCollection(result, 'redirects')
    expect(fieldByName(redirects.fields, 'hits')).toBeUndefined()
    expect(fieldByName(redirects.fields, 'lastAccess')).toBeUndefined()
    expect(result.endpoints?.map((endpoint) => endpoint.path)).toEqual([
      '/payload-redirects/refresh-cache',
    ])
  })

  it('registers endpoints under a custom endpointsPath', async () => {
    const result = await redirectsPlugin(pluginConfig({ endpointsPath: '/custom-redirects' }))(
      baseConfig(),
    )
    expect(result.endpoints?.map((endpoint) => endpoint.path)).toEqual([
      '/custom-redirects/refresh-cache',
      '/custom-redirects/hit/:id',
    ])
  })

  it('applies collection overrides last', async () => {
    const result = await redirectsPlugin(
      pluginConfig({
        overrides: ({ collection }) => ({
          ...collection,
          admin: { ...collection.admin, group: 'Custom' },
        }),
      }),
    )(baseConfig())
    expect(getCollection(result, 'redirects').admin?.group).toBe('Custom')
  })

  it('keeps the collection but nothing else when disabled', async () => {
    const result = await redirectsPlugin(pluginConfig({ disabled: true }))(baseConfig())
    expect(getCollection(result, 'redirects')).toBeDefined()
    expect(getCollection(result, 'redirects').hooks).toBeUndefined()
    expect(result.endpoints ?? []).toEqual([])
    expect(getCollection(result, 'pages').hooks).toBeUndefined()
    expect(() => getRedirectsConfig(result)).toThrow(/not found/)
  })

  it('throws when the slug is already taken', () => {
    const config = baseConfig()
    config.collections?.push({ slug: 'redirects', fields: [] })
    expect(() => redirectsPlugin(pluginConfig())(config)).toThrow(/already exists/)
  })
})

describe('field validation', () => {
  it('accepts pathnames and http(s) URLs only', () => {
    expect(validateUrlOrPathname('/somewhere')).toBe(true)
    expect(validateUrlOrPathname('https://example.com/x')).toBe(true)
    expect(validateUrlOrPathname('ftp://example.com')).toMatch(/Invalid/)
    expect(validateUrlOrPathname('no-slash')).toMatch(/Invalid/)
    expect(validateUrlOrPathname('  ')).toMatch(/required/)
    expect(validateUrlOrPathname(undefined)).toMatch(/required/)
  })

  it('validates from as URL/pathname, or as a regex with useRegex', () => {
    const options = (useRegex: boolean) => ({ siblingData: { useRegex } }) as never
    expect(validateFromField('/old', options(false))).toBe(true)
    expect(validateFromField('bad', options(false))).toMatch(/Invalid/)
    expect(validateFromField('^/blog/(.*)$', options(true))).toBe(true)
    expect(validateFromField('([', options(true))).toMatch(/Invalid regular expression/)
    expect(validateFromField('', options(true))).toMatch(/required/)
  })

  it('rejects whitespace in scrollTo and allows empty values', () => {
    expect(validateScrollTo('team')).toBe(true)
    expect(validateScrollTo('#team')).toBe(true)
    expect(validateScrollTo('')).toBe(true)
    expect(validateScrollTo(undefined)).toBe(true)
    expect(validateScrollTo('two words')).toMatch(/whitespace/)
  })
})

describe('buildRedirectsCacheEntries', () => {
  const build = async (docs: unknown[], overrides: Partial<RedirectsPluginConfig> = {}) => {
    const result = await redirectsPlugin(pluginConfig(overrides))(baseConfig())
    const req = makeReq(result, { find: vi.fn(() => Promise.resolve({ docs })) })
    return buildRedirectsCacheEntries({
      config: getRedirectsConfig(result),
      payload: req.payload,
      req,
    })
  }

  it('denormalizes custom and reference redirects, applying scrollTo fragments', async () => {
    const entries = await build([
      {
        id: 1,
        type: '301',
        from: 'https://example.com/old/',
        to: { type: 'custom', url: '/landing' },
      },
      {
        id: 2,
        type: '302',
        from: '/team',
        to: {
          type: 'reference',
          reference: { relationTo: 'pages', value: { id: 9, slug: 'about' } },
          scrollTo: '#team',
        },
      },
    ])

    expect(entries).toEqual([
      { id: '1', type: '301', from: '/old', to: '/landing' },
      { id: '2', type: '302', from: '/team', to: '/about#team' },
    ])
  })

  it('keeps regex sources verbatim and flags them', async () => {
    const entries = await build([
      {
        id: 1,
        type: '301',
        from: '^/blog/(.*)$',
        to: { type: 'custom', url: '/news/$1' },
        useRegex: true,
      },
    ])
    expect(entries).toEqual([
      { id: '1', type: '301', from: '^/blog/(.*)$', regex: true, to: '/news/$1' },
    ])
  })

  it('drops rows that cannot produce a working redirect', async () => {
    const entries = await build([
      { id: 1, type: '308', from: '/a', to: { type: 'custom', url: '/x' } },
      { id: 2, type: '301', from: '  ', to: { type: 'custom', url: '/x' } },
      {
        id: 3,
        type: '301',
        from: '/unpopulated',
        to: { type: 'reference', reference: { relationTo: 'pages', value: 7 } },
      },
      {
        id: 4,
        type: '301',
        from: '/unknown-collection',
        to: { type: 'reference', reference: { relationTo: 'posts', value: { id: 1 } } },
      },
      { id: 5, type: '301', from: '/empty-url', to: { type: 'custom', url: '  ' } },
      { id: 6, type: '301', from: '/works', to: { type: 'custom', url: '/x' } },
    ])
    expect(entries).toEqual([{ id: '6', type: '301', from: '/works', to: '/x' }])
  })

  it('treats a missing to.type as a custom URL (no reference picker configured)', async () => {
    const entries = await build([{ id: 1, type: '301', from: '/old', to: { url: '/new' } }], {
      collections: undefined,
    })
    expect(entries).toEqual([{ id: '1', type: '301', from: '/old', to: '/new' }])
  })
})

describe('re-sync hooks', () => {
  const setup = async () => {
    const cache = memoryCache()
    const result = await redirectsPlugin(pluginConfig({ cache }))(baseConfig())
    const setSpy = vi.spyOn(cache, 'set')
    return { result, setSpy }
  }

  it('rewrites the cache when a redirect changes, and propagates failures', async () => {
    const { result, setSpy } = await setup()
    const hook = getCollection(result, 'redirects').hooks?.afterChange?.[0]
    await hook?.({ req: makeReq(result) } as never)
    expect(setSpy).toHaveBeenCalledWith([])

    const failing = await redirectsPlugin(
      pluginConfig({
        cache: {
          get: () => Promise.resolve(null),
          set: () => Promise.reject(new Error('backend down')),
        },
      }),
    )(baseConfig())
    const failingHook = getCollection(failing, 'redirects').hooks?.afterChange?.[0]
    await expect(failingHook?.({ req: makeReq(failing) } as never)).rejects.toThrow(/backend down/)
  })

  it('re-syncs on published path changes of destination collections only', async () => {
    const { result, setSpy } = await setup()
    const hook = getCollection(result, 'pages').hooks?.afterChange?.[0]
    const run = (args: Record<string, unknown>) =>
      hook?.({ req: makeReq(result), ...args } as never)

    await run({ doc: { slug: 'a' }, operation: 'create' })
    await run({
      doc: { slug: 'b', _status: 'draft' },
      operation: 'update',
      previousDoc: { slug: 'a' },
    })
    await run({
      doc: { slug: 'same', _status: 'published' },
      operation: 'update',
      previousDoc: { slug: 'same', _status: 'published' },
    })
    expect(setSpy).not.toHaveBeenCalled()

    await run({
      doc: { slug: 'moved', _status: 'published' },
      operation: 'update',
      previousDoc: { slug: 'original', _status: 'published' },
    })
    expect(setSpy).toHaveBeenCalledTimes(1)

    // The previous doc being a draft hides the old published path — re-sync.
    await run({
      doc: { slug: 'same', _status: 'published' },
      operation: 'update',
      previousDoc: { slug: 'same', _status: 'draft' },
    })
    expect(setSpy).toHaveBeenCalledTimes(2)
  })

  it('re-syncs on destination deletes and logs (not throws) on failure', async () => {
    const { result, setSpy } = await setup()
    const deleteHook = getCollection(result, 'pages').hooks?.afterDelete?.[0]
    await deleteHook?.({ req: makeReq(result) } as never)
    expect(setSpy).toHaveBeenCalledTimes(1)

    const failing = await redirectsPlugin(
      pluginConfig({
        cache: {
          get: () => Promise.resolve(null),
          set: () => Promise.reject(new Error('backend down')),
        },
      }),
    )(baseConfig())
    const failingReq = makeReq(failing)
    const failingHook = getCollection(failing, 'pages').hooks?.afterDelete?.[0]
    await expect(failingHook?.({ req: failingReq } as never)).resolves.toBeUndefined()
    expect(failingReq.payload.logger.error).toHaveBeenCalled()
  })

  it('posts do not get hooks — only configured destinations and the redirects collection', async () => {
    const { result } = await setup()
    expect(getCollection(result, 'posts').hooks).toBeUndefined()
  })
})

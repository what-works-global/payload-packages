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
  validateQueryParamKey,
  validateSafeRegexPattern,
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
    expect(fieldByName(toGroup.fields, 'queryParams')?.type).toBe('array')

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

  it('exposes a destination column backed by the custom cell', async () => {
    const cellPath = '@whatworks/payload-redirects/rsc#RedirectDestinationCell'
    const cellOf = (field: Field | undefined): unknown =>
      (field as { admin?: { components?: { Cell?: unknown } } } | undefined)?.admin?.components
        ?.Cell

    // The custom destination cell replaces the raw to.type / to.url as the second
    // default column, in both the reference and custom-only collection shapes.
    const withRefs = getCollection(await redirectsPlugin(pluginConfig())(baseConfig()), 'redirects')
    const destination = fieldByName(withRefs.fields, 'destination')
    expect(destination?.type).toBe('ui')
    expect(cellOf(destination)).toBe(cellPath)
    expect(withRefs.admin?.defaultColumns?.[1]).toBe('destination')

    const withoutRefs = getCollection(
      await redirectsPlugin(pluginConfig({ collections: undefined }))(baseConfig()),
      'redirects',
    )
    expect(fieldByName(withoutRefs.fields, 'destination')?.type).toBe('ui')
    expect(withoutRefs.admin?.defaultColumns?.[1]).toBe('destination')
  })

  it('adds a "Test" redirect action as a sidebar button and a list column', async () => {
    const componentsOf = (
      field: Field | undefined,
    ): { Cell?: unknown; Field?: unknown } | undefined =>
      (field as { admin?: { components?: { Cell?: unknown; Field?: unknown } } } | undefined)?.admin
        ?.components
    const positionOf = (field: Field | undefined): unknown =>
      (field as { admin?: { position?: unknown } } | undefined)?.admin?.position

    const redirects = getCollection(
      await redirectsPlugin(pluginConfig())(baseConfig()),
      'redirects',
    )
    const testRedirect = fieldByName(redirects.fields, 'testRedirect')
    expect(testRedirect?.type).toBe('ui')
    expect((testRedirect as { label?: unknown } | undefined)?.label).toBe('Test Redirect')
    // Sidebar edit-form button.
    expect(positionOf(testRedirect)).toBe('sidebar')
    expect(componentsOf(testRedirect)?.Field).toBe(
      '@whatworks/payload-redirects/client#TestRedirectButton',
    )
    // List-view "Test" column cell, shown by default.
    expect(componentsOf(testRedirect)?.Cell).toBe(
      '@whatworks/payload-redirects/client#TestRedirectCell',
    )
    expect(redirects.admin?.defaultColumns).toContain('testRedirect')
  })

  it('drops hit tracking with trackHits: false', async () => {
    const result = await redirectsPlugin(pluginConfig({ trackHits: false }))(baseConfig())
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

  it('validates from according to matchType', () => {
    const options = (matchType: string) => ({ siblingData: { matchType } }) as never
    // exact → URL/pathname rules
    expect(validateFromField('/old', options('exact'))).toBe(true)
    expect(validateFromField('bad', options('exact'))).toMatch(/Invalid/)
    // regex → safe-regex rules
    expect(validateFromField('^/blog/(.*)$', options('regex'))).toBe(true)
    expect(validateFromField('([', options('regex'))).toMatch(/Invalid regular expression/)
    expect(validateFromField('', options('regex'))).toMatch(/required/)
    // startsWith/contains → any non-empty substring is valid (no leading slash needed)
    expect(validateFromField('blog', options('contains'))).toBe(true)
    expect(validateFromField('/section', options('startsWith'))).toBe(true)
    expect(validateFromField('  ', options('startsWith'))).toMatch(/required/)
    // missing matchType defaults to exact
    expect(validateFromField('bad', { siblingData: {} } as never)).toMatch(/Invalid/)
  })

  it('accepts safe regex patterns and rejects catastrophic / unsafe ones', () => {
    // Accepts
    expect(validateSafeRegexPattern('^/blog/(.*)$')).toBe(true)
    expect(validateSafeRegexPattern('^/docs(/.*)?$')).toBe(true)
    expect(validateSafeRegexPattern('(ab)+')).toBe(true)
    expect(validateSafeRegexPattern('a{1,1000}')).toBe(true)
    expect(validateSafeRegexPattern('(a+){0,5}')).toBe(true)
    // Rejects: nested unbounded quantifiers (catastrophic backtracking)
    expect(validateSafeRegexPattern('(a+)+')).toMatch(/catastrophic/i)
    expect(validateSafeRegexPattern('(a*)*')).toMatch(/catastrophic/i)
    expect(validateSafeRegexPattern('((a+))+')).toMatch(/catastrophic/i)
    expect(validateSafeRegexPattern('(?:a+)+')).toMatch(/catastrophic/i)
    expect(validateSafeRegexPattern('(a+){2,}')).toMatch(/catastrophic/i)
    // Rejects: backreferences
    expect(validateSafeRegexPattern('(a)\\1')).toMatch(/[Bb]ackreference/)
    // Rejects: bounded repetition above 1000
    expect(validateSafeRegexPattern('a{1001}')).toMatch(/1000/)
    expect(validateSafeRegexPattern('a{1,2000}')).toMatch(/1000/)
    // Rejects: too long / uncompilable / empty
    expect(validateSafeRegexPattern(`^${'a'.repeat(300)}$`)).toMatch(/too long/i)
    expect(validateSafeRegexPattern('([')).toMatch(/Invalid regular expression/)
    expect(validateSafeRegexPattern('')).toMatch(/required/)
  })

  it('rejects whitespace in scrollTo and allows empty values', () => {
    expect(validateScrollTo('team')).toBe(true)
    expect(validateScrollTo('#team')).toBe(true)
    expect(validateScrollTo('')).toBe(true)
    expect(validateScrollTo(undefined)).toBe(true)
    expect(validateScrollTo('two words')).toMatch(/whitespace/)
  })

  it('validates a query parameter name (required, no reserved characters)', () => {
    expect(validateQueryParamKey('utm_source')).toBe(true)
    expect(validateQueryParamKey('')).toMatch(/required/)
    expect(validateQueryParamKey(undefined)).toMatch(/required/)
    expect(validateQueryParamKey('two words')).toMatch(/spaces/)
    expect(validateQueryParamKey('a=b')).toMatch(/#/)
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
        from: 'https://example.com/old/',
        status: '301',
        to: { type: 'custom', url: '/landing' },
      },
      {
        id: 2,
        from: '/team',
        status: '302',
        to: {
          type: 'reference',
          reference: { relationTo: 'pages', value: { id: 9, slug: 'about' } },
          scrollTo: '#team',
        },
      },
    ])

    expect(entries).toEqual([
      { id: '1', from: '/old', status: 301, to: '/landing' },
      { id: '2', from: '/team', status: 302, to: '/about#team' },
    ])
  })

  it('applies queryParams to the destination, alongside scrollTo', async () => {
    const entries = await build([
      {
        id: 1,
        from: '/promo',
        status: '301',
        to: {
          type: 'custom',
          queryParams: [
            { key: 'utm_source', value: 'nl' },
            { key: 'utm_medium', value: 'email' },
          ],
          url: '/sale',
        },
      },
      {
        id: 2,
        from: '/team',
        status: '301',
        to: {
          type: 'reference',
          queryParams: [{ key: 'ref', value: 'old' }],
          reference: { relationTo: 'pages', value: { id: 9, slug: 'about' } },
          scrollTo: 'team',
        },
      },
    ])

    expect(entries).toEqual([
      { id: '1', from: '/promo', status: 301, to: '/sale?utm_source=nl&utm_medium=email' },
      { id: '2', from: '/team', status: 301, to: '/about?ref=old#team' },
    ])
  })

  it('keeps regex sources verbatim and flags them with matchType', async () => {
    const entries = await build([
      {
        id: 1,
        from: '^/blog/(.*)$',
        matchType: 'regex',
        status: '301',
        to: { type: 'custom', url: '/news/$1' },
      },
    ])
    expect(entries).toEqual([
      { id: '1', from: '^/blog/(.*)$', match: 'regex', status: 301, to: '/news/$1' },
    ])
  })

  it('emits per-entry match/caseInsensitive/forwardQuery flags only when set', async () => {
    const entries = await build([
      {
        id: 1,
        caseInsensitive: true,
        forwardQuery: true,
        status: '301',
        // non-exact `from` is trimmed only, never canonicalized
        from: '/Blog/',
        matchType: 'startsWith',
        to: { type: 'custom', url: '/news' },
      },
    ])
    expect(entries).toEqual([
      {
        id: '1',
        caseInsensitive: true,
        forwardQuery: true,
        from: '/Blog/',
        match: 'startsWith',
        status: 301,
        to: '/news',
      },
    ])
  })

  it('excludes disabled redirects from the cache', async () => {
    const entries = await build([
      { id: 1, enabled: false, from: '/off', status: '301', to: { type: 'custom', url: '/x' } },
      { id: 2, enabled: true, from: '/on', status: '301', to: { type: 'custom', url: '/y' } },
      { id: 3, from: '/default-on', status: '301', to: { type: 'custom', url: '/z' } },
    ])
    expect(entries.map((entry) => entry.from)).toEqual(['/on', '/default-on'])
  })

  it('flattens exact redirect chains to a single hop, carrying the earliest fragment', async () => {
    const entries = await build([
      { id: 1, from: '/a', status: '301', to: { type: 'custom', scrollTo: 'top', url: '/b' } },
      { id: 2, from: '/b', status: '301', to: { type: 'custom', url: '/c' } },
    ])
    expect(entries).toEqual([
      { id: '1', from: '/a', status: 301, to: '/c#top' },
      { id: '2', from: '/b', status: 301, to: '/c' },
    ])
  })

  it('leaves cyclic chains unflattened and warns', async () => {
    const result = await redirectsPlugin(pluginConfig())(baseConfig())
    const warn = vi.fn()
    const req = makeReq(result, {
      find: vi.fn(() =>
        Promise.resolve({
          docs: [
            { id: 1, from: '/a', status: '301', to: { type: 'custom', url: '/b' } },
            { id: 2, from: '/b', status: '301', to: { type: 'custom', url: '/a' } },
          ],
        }),
      ),
      logger: { error: vi.fn(), info: vi.fn(), warn },
    })
    const entries = await buildRedirectsCacheEntries({
      config: getRedirectsConfig(result),
      payload: req.payload,
      req,
    })
    expect(entries).toEqual([
      { id: '1', from: '/a', status: 301, to: '/b' },
      { id: '2', from: '/b', status: 301, to: '/a' },
    ])
    expect(warn).toHaveBeenCalled()
  })

  it('drops rows that cannot produce a working redirect', async () => {
    const entries = await build([
      { id: 1, from: '/a', status: '308', to: { type: 'custom', url: '/x' } },
      { id: 2, from: '  ', status: '301', to: { type: 'custom', url: '/x' } },
      {
        id: 3,
        from: '/unpopulated',
        status: '301',
        to: { type: 'reference', reference: { relationTo: 'pages', value: 7 } },
      },
      {
        id: 4,
        from: '/unknown-collection',
        status: '301',
        to: { type: 'reference', reference: { relationTo: 'posts', value: { id: 1 } } },
      },
      { id: 5, from: '/empty-url', status: '301', to: { type: 'custom', url: '  ' } },
      { id: 6, from: '/works', status: '301', to: { type: 'custom', url: '/x' } },
    ])
    expect(entries).toEqual([{ id: '6', from: '/works', status: 301, to: '/x' }])
  })

  it('treats a missing to.type as a custom URL (no reference picker configured)', async () => {
    const entries = await build([{ id: 1, from: '/old', status: '301', to: { url: '/new' } }], {
      collections: undefined,
    })
    expect(entries).toEqual([{ id: '1', from: '/old', status: 301, to: '/new' }])
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

describe('onInit composition', () => {
  const stubPayload = (result: Config, logger: Record<string, unknown> = {}) =>
    makeReq(result, {
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), ...logger },
    }).payload

  it('runs a prior onInit, then primes the cache from the database', async () => {
    const priorOnInit = vi.fn()
    const base = baseConfig()
    base.onInit = priorOnInit
    const result = await redirectsPlugin(pluginConfig())(base)

    const setSpy = vi.spyOn(getRedirectsConfig(result).cache, 'set')
    await result.onInit?.(stubPayload(result))

    expect(priorOnInit).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith([])
  })

  it('skips the init sync when syncOnInit is false', async () => {
    const result = await redirectsPlugin(pluginConfig({ syncOnInit: false }))(baseConfig())
    const setSpy = vi.spyOn(getRedirectsConfig(result).cache, 'set')
    await result.onInit?.(stubPayload(result))
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('logs (never throws) when the init sync fails', async () => {
    const result = await redirectsPlugin(
      pluginConfig({
        cache: {
          get: () => Promise.resolve(null),
          set: () => Promise.reject(new Error('backend down')),
        },
      }),
    )(baseConfig())
    const error = vi.fn()
    await expect(result.onInit?.(stubPayload(result, { error }))).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })

  it('warns in production only when no secret is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const open = await redirectsPlugin(pluginConfig())(baseConfig())
    const openWarn = vi.fn()
    await open.onInit?.(stubPayload(open, { warn: openWarn }))
    expect(openWarn).toHaveBeenCalledWith(expect.stringContaining('secret'))

    const secured = await redirectsPlugin(pluginConfig({ secret: 's3cret' }))(baseConfig())
    const securedWarn = vi.fn()
    await secured.onInit?.(stubPayload(secured, { warn: securedWarn }))
    expect(securedWarn).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('does not warn outside production even without a secret', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const result = await redirectsPlugin(pluginConfig())(baseConfig())
    const warn = vi.fn()
    await result.onInit?.(stubPayload(result, { warn }))
    expect(warn).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('composes no onInit when disabled', async () => {
    const result = await redirectsPlugin(pluginConfig({ disabled: true }))(baseConfig())
    expect(result.onInit).toBeUndefined()
  })
})

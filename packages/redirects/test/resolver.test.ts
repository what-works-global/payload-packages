import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CachedRedirect, RedirectsCache } from '../src/exports/resolver.js'

import { memoryCache } from '../src/exports/cache.js'
import { createRedirectsRequestHandler, createRedirectsResolver } from '../src/exports/resolver.js'

const entry = (overrides: Partial<CachedRedirect> = {}): CachedRedirect => ({
  id: '1',
  type: '301',
  from: '/old',
  to: '/new',
  ...overrides,
})

const primedCache = async (entries: CachedRedirect[]): Promise<RedirectsCache> => {
  const cache = memoryCache()
  await cache.set(entries)
  return cache
}

type FakeCtx = { tasks: Promise<unknown>[]; waitUntil: (task: Promise<unknown>) => void }

const fakeCtx = (): FakeCtx => {
  const tasks: Promise<unknown>[] = []
  return {
    tasks,
    waitUntil: (task) => {
      tasks.push(task)
    },
  }
}

const okFetch = () =>
  vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  )

const firstUrl = (fetchMock: ReturnType<typeof okFetch>) =>
  String((fetchMock.mock.calls[0] as unknown as [URL])[0])

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createRedirectsResolver', () => {
  it('resolves a matching request to a destination + status', async () => {
    const resolver = createRedirectsResolver({
      cache: await primedCache([entry(), entry({ id: '2', type: '302', from: '/temp', to: '/x' })]),
      trackHits: false,
    })

    expect(await resolver('https://site.com/old')).toEqual({
      destination: '/new',
      redirect: entry(),
      status: 301,
    })
    expect((await resolver('https://site.com/temp'))?.status).toBe(302)
    expect(await resolver('https://site.com/unmatched')).toBeNull()
  })

  it('accepts a URL instance as well as a string', async () => {
    const resolver = createRedirectsResolver({
      cache: await primedCache([entry()]),
      trackHits: false,
    })
    expect((await resolver(new URL('https://site.com/old')))?.destination).toBe('/new')
  })

  it('memoizes the cache read within cacheMemoMs', async () => {
    const get = vi.fn(() => Promise.resolve<CachedRedirect[] | null>([entry()]))
    const resolver = createRedirectsResolver({
      cache: { get, set: () => Promise.resolve() },
      cacheMemoMs: 5000,
      trackHits: false,
    })

    await resolver('https://site.com/old')
    await resolver('https://site.com/old')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('re-reads the cache on every request when memoization is off', async () => {
    const get = vi.fn(() => Promise.resolve<CachedRedirect[] | null>([entry()]))
    const resolver = createRedirectsResolver({
      cache: { get, set: () => Promise.resolve() },
      cacheMemoMs: 0,
      trackHits: false,
    })

    await resolver('https://site.com/old')
    await resolver('https://site.com/old')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('refreshes the cache in the background on a miss (via waitUntil)', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({ cache: memoryCache() })
    const ctx = fakeCtx()
    expect(await resolver('https://site.com/old', ctx)).toBeNull()

    await Promise.all(ctx.tasks)
    expect(firstUrl(fetchMock)).toBe('https://site.com/api/payload-redirects/refresh-cache')

    // An empty list is a valid cached state, not a miss.
    fetchMock.mockClear()
    const emptied = createRedirectsResolver({ cache: await primedCache([]) })
    expect(await emptied('https://site.com/old', fakeCtx())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    // …and refreshOnMiss: false stays quiet entirely.
    const disabled = createRedirectsResolver({ cache: memoryCache(), refreshOnMiss: false })
    expect(await disabled('https://site.com/old', fakeCtx())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tracks hits through the plugin endpoint', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({
      apiBasePath: '/api/payload',
      cache: await primedCache([entry({ id: 'abc' })]),
    })

    const ctx = fakeCtx()
    expect((await resolver('https://site.com/old', ctx))?.status).toBe(301)

    await Promise.all(ctx.tasks)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [hitUrl, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(hitUrl)).toBe('https://site.com/api/payload/payload-redirects/hit/abc')
    expect(init.method).toBe('POST')
  })

  it('fires-and-forgets background work when no waitUntil is given', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({ cache: await primedCache([entry({ id: 'abc' })]) })
    expect((await resolver('https://site.com/old'))?.status).toBe(301)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the secret header on hit and refresh requests when configured', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const withHits = createRedirectsResolver({
      cache: await primedCache([entry({ id: 'abc' })]),
      secret: 'sesame',
    })
    const hitCtx = fakeCtx()
    await withHits('https://site.com/old', hitCtx)
    await Promise.all(hitCtx.tasks)
    const [, hitInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(headerOf(hitInit, 'x-payload-redirects-secret')).toBe('sesame')

    fetchMock.mockClear()

    const onMiss = createRedirectsResolver({ cache: memoryCache(), secret: 'sesame' })
    const missCtx = fakeCtx()
    await onMiss('https://site.com/old', missCtx)
    await Promise.all(missCtx.tasks)
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(refreshUrl)).toBe('https://site.com/api/payload-redirects/refresh-cache')
    expect(headerOf(refreshInit, 'x-payload-redirects-secret')).toBe('sesame')
  })

  it('omits the secret header when no secret is configured', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({ cache: await primedCache([entry({ id: 'abc' })]) })
    const ctx = fakeCtx()
    await resolver('https://site.com/old', ctx)
    await Promise.all(ctx.tasks)
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.headers).toBeUndefined()
  })

  it('targets endpointsBaseUrl for a split-origin deployment, not the request origin', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({
      cache: await primedCache([entry({ id: 'abc' })]),
      endpointsBaseUrl: 'https://cms.example.com/api',
    })
    const hitCtx = fakeCtx()
    await resolver('https://site.com/old', hitCtx)
    await Promise.all(hitCtx.tasks)
    // Hit goes to the absolute API base, NOT the request's site.com origin.
    expect(firstUrl(fetchMock)).toBe('https://cms.example.com/api/payload-redirects/hit/abc')

    fetchMock.mockClear()

    const onMiss = createRedirectsResolver({
      cache: memoryCache(),
      endpointsBaseUrl: 'https://cms.example.com/api',
    })
    const missCtx = fakeCtx()
    await onMiss('https://site.com/old', missCtx)
    await Promise.all(missCtx.tasks)
    expect(firstUrl(fetchMock)).toBe('https://cms.example.com/api/payload-redirects/refresh-cache')
  })

  it('forwards the request query when forwardQuery is set (destination params win)', async () => {
    const resolver = createRedirectsResolver({
      cache: await primedCache([
        entry({ forwardQuery: true }),
        entry({ id: '2', forwardQuery: true, from: '/keep', to: '/dest?ref=keep' }),
      ]),
      trackHits: false,
    })

    expect((await resolver('https://site.com/old?ref=abc'))?.destination).toBe('/new?ref=abc')
    expect((await resolver('https://site.com/keep?ref=abc&extra=1'))?.destination).toBe(
      '/dest?ref=keep&extra=1',
    )
  })

  it('appends trailing slashes to relative destinations when trailingSlash is set', async () => {
    const resolver = createRedirectsResolver({
      cache: await primedCache([
        entry({ from: '/old', to: '/about' }),
        entry({ id: '2', from: '/file', to: '/logo.png' }),
        entry({ id: '3', from: '/ext', to: 'https://elsewhere.com/page' }),
      ]),
      trackHits: false,
      trailingSlash: true,
    })

    expect((await resolver('https://site.com/old'))?.destination).toBe('/about/')
    // File-like last segments and absolute destinations are exempt.
    expect((await resolver('https://site.com/file'))?.destination).toBe('/logo.png')
    expect((await resolver('https://site.com/ext'))?.destination).toBe('https://elsewhere.com/page')
  })

  it('invokes onRedirect in the background with the matched url, swallowing errors', async () => {
    const onRedirect = vi.fn(() => Promise.resolve())
    const resolver = createRedirectsResolver({
      cache: await primedCache([entry({ id: 'abc' })]),
      onRedirect,
      trackHits: false,
    })

    const ctx = fakeCtx()
    await resolver('https://site.com/old', ctx)
    await Promise.all(ctx.tasks)
    expect(onRedirect).toHaveBeenCalledTimes(1)
    const [args] = onRedirect.mock.calls[0] as unknown as [
      { destination: string; redirect: CachedRedirect; url: URL },
    ]
    expect(args.destination).toBe('/new')
    expect(args.redirect.id).toBe('abc')
    expect(args.url).toBeInstanceOf(URL)
    expect(args.url.href).toBe('https://site.com/old')

    const throwing = createRedirectsResolver({
      cache: await primedCache([entry()]),
      onRedirect: () => {
        throw new Error('hook boom')
      },
      trackHits: false,
    })
    const throwCtx = fakeCtx()
    expect((await throwing('https://site.com/old', throwCtx))?.status).toBe(301)
    await expect(Promise.all(throwCtx.tasks)).resolves.toBeDefined()
  })

  it('logs match/miss/skip diagnostics when debug is enabled', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const matcher = createRedirectsResolver({
      cache: await primedCache([entry()]),
      debug: true,
      trackHits: false,
    })
    await matcher('https://site.com/old')
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[payload-redirects] match /old'))

    debugSpy.mockClear()
    const misser = createRedirectsResolver({
      cache: memoryCache(),
      debug: true,
      refreshOnMiss: false,
    })
    await misser('https://site.com/old')
    expect(debugSpy).toHaveBeenCalledWith('[payload-redirects] cache miss')

    debugSpy.mockClear()
    const openMw = createRedirectsResolver({
      cache: await primedCache([entry({ from: '^/r/(.+)$', match: 'regex', to: '/$1' })]),
      debug: true,
      refreshOnMiss: false,
      trackHits: false,
    })
    expect(await openMw('https://site.com/r//evil.com')).toBeNull()
    expect(debugSpy).toHaveBeenCalledWith(
      '[payload-redirects] skipped "^/r/(.+)$" -> "//evil.com": open-redirect',
    )
  })

  it('survives cache errors and filters malformed cached entries', async () => {
    const cache = memoryCache()
    await cache.set([{ junk: true } as unknown as CachedRedirect, entry()])
    const resolver = createRedirectsResolver({ cache, trackHits: false })
    expect((await resolver('https://site.com/old'))?.status).toBe(301)

    const broken = createRedirectsResolver({
      cache: {
        get: () => Promise.reject(new Error('backend down')),
        set: () => Promise.resolve(),
      },
    })
    expect(await broken('https://site.com/old')).toBeNull()
  })
})

describe('createRedirectsRequestHandler', () => {
  it('answers a matching Request with a Response redirect', async () => {
    const handler = createRedirectsRequestHandler({
      cache: await primedCache([entry(), entry({ id: '2', type: '302', from: '/temp', to: '/x' })]),
      trackHits: false,
    })

    const permanent = await handler(new Request('https://site.com/old'))
    expect(permanent?.status).toBe(301)
    expect(permanent?.headers.get('location')).toBe('https://site.com/new')

    const temporary = await handler(new Request('https://site.com/temp'))
    expect(temporary?.status).toBe(302)
    expect(temporary?.headers.get('location')).toBe('https://site.com/x')
  })

  it('absolutizes relative destinations against the request and leaves absolute ones alone', async () => {
    const handler = createRedirectsRequestHandler({
      cache: await primedCache([
        entry({ to: '/about#team' }),
        entry({ id: '2', from: '/ext', to: 'https://elsewhere.com/page' }),
      ]),
      trackHits: false,
    })

    expect((await handler(new Request('https://site.com/old')))?.headers.get('location')).toBe(
      'https://site.com/about#team',
    )
    expect((await handler(new Request('https://site.com/ext')))?.headers.get('location')).toBe(
      'https://elsewhere.com/page',
    )
  })

  it('returns null when nothing matches', async () => {
    const handler = createRedirectsRequestHandler({
      cache: await primedCache([entry()]),
      trackHits: false,
    })
    expect(await handler(new Request('https://site.com/nope'))).toBeNull()
  })

  it('forwards a waitUntil for background work', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const handler = createRedirectsRequestHandler({
      cache: await primedCache([entry({ id: 'abc' })]),
    })
    const ctx = fakeCtx()
    await handler(new Request('https://site.com/old'), ctx)
    await Promise.all(ctx.tasks)
    expect(firstUrl(fetchMock)).toBe('https://site.com/api/payload-redirects/hit/abc')
  })
})

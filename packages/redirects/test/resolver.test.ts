import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CachedRedirect, RedirectsCache } from '../src/exports/resolver.js'

import { memoryCache } from '../src/exports/cache.js'
import { createRedirectsRequestHandler, createRedirectsResolver } from '../src/exports/resolver.js'

const entry = (overrides: Partial<CachedRedirect> = {}): CachedRedirect => ({
  id: '1',
  from: '/old',
  status: 301,
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

/** Every URL the mock was called with — the miss path tries the list route first. */
const urlsOf = (fetchMock: { mock: { calls: unknown[] } }) =>
  fetchMock.mock.calls.map((call) => String((call as [URL])[0]))

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('createRedirectsResolver', () => {
  it('resolves a matching request to a destination + status', async () => {
    const resolver = createRedirectsResolver({
      cache: await primedCache([entry(), entry({ id: '2', from: '/temp', status: 302, to: '/x' })]),
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
    // With a list route (the default) a miss reads through to it, and nothing
    // else: this one yields nothing usable, and that is not a reason to boot the
    // origin again with a refresh POST.
    expect(urlsOf(fetchMock)).toEqual(['https://site.com/api/payload-redirects/list'])

    // Without a list route, the refresh POST is the only call.
    fetchMock.mockClear()
    const legacy = createRedirectsResolver({ cache: memoryCache(), list: { disabled: true } })
    const legacyCtx = fakeCtx()
    expect(await legacy('https://site.com/old', legacyCtx)).toBeNull()
    await Promise.all(legacyCtx.tasks)
    expect(urlsOf(fetchMock)).toEqual(['https://site.com/api/payload-redirects/refresh-cache'])

    // An empty list is a valid cached state, not a miss.
    fetchMock.mockClear()
    const emptied = createRedirectsResolver({ cache: await primedCache([]) })
    expect(await emptied('https://site.com/old', fakeCtx())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    // …and refreshOnMiss: false stays quiet entirely.
    const disabled = createRedirectsResolver({
      cache: memoryCache(),
      list: { disabled: true },
      refreshOnMiss: false,
    })
    expect(await disabled('https://site.com/old', fakeCtx())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends one refresh at a time without a list route, backing off until the cache answers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)

    let settle: (() => void) | undefined
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          settle = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const cache = memoryCache()
    const resolver = createRedirectsResolver({
      cache,
      cacheMemoMs: 0,
      list: { disabled: true },
      trackHits: false,
    })

    // A burst of misses while the first refresh is still running sends one.
    const ctx = fakeCtx()
    for (let index = 0; index < 20; index++) {
      expect(await resolver('https://site.com/old', ctx)).toBeNull()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Even once it settles, the next waits out the back-off: this instance cannot
    // tell whether it helped until a read succeeds (on a multi-region read path
    // it never will).
    settle?.()
    await Promise.all(ctx.tasks)
    await resolver('https://site.com/old', ctx)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(1000)
    await resolver('https://site.com/old', ctx)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    settle?.()
    await Promise.all(ctx.tasks)

    // 2s next…
    vi.setSystemTime(2999)
    await resolver('https://site.com/old', ctx)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // …unless the cache answers, which resets it.
    await cache.set([entry()])
    expect((await resolver('https://site.com/old', ctx))?.status).toBe(301)
    await cache.set(null as unknown as CachedRedirect[])
    await resolver('https://site.com/old', ctx)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    settle?.()
    await Promise.all(ctx.tasks)
  })

  it('tracks hits through the plugin endpoint', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({
      api: '/api/payload',
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

    const onMiss = createRedirectsResolver({
      cache: memoryCache(),
      list: { disabled: true },
      secret: 'sesame',
    })
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

  it('targets an absolute api base for a split-origin deployment, not the request origin', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({
      api: 'https://cms.example.com/api',
      cache: await primedCache([entry({ id: 'abc' })]),
    })
    const hitCtx = fakeCtx()
    await resolver('https://site.com/old', hitCtx)
    await Promise.all(hitCtx.tasks)
    // Hit goes to the absolute API base, NOT the request's site.com origin.
    expect(firstUrl(fetchMock)).toBe('https://cms.example.com/api/payload-redirects/hit/abc')

    fetchMock.mockClear()

    const onMiss = createRedirectsResolver({
      api: 'https://cms.example.com/api',
      cache: memoryCache(),
      list: { disabled: true },
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

describe('read-through via list.path', () => {
  /** A fetch mock that serves the list route and 200s everything else. */
  const listFetch = (redirects: unknown) =>
    vi.fn((input: string | URL, _init?: RequestInit) => {
      if (String(input).includes('/list')) {
        return Promise.resolve(new Response(JSON.stringify({ redirects }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })

  it('answers the missed request from the list route and seeds the cache', async () => {
    const fetchMock = listFetch([entry()])
    vi.stubGlobal('fetch', fetchMock)

    const cache = memoryCache()
    const resolver = createRedirectsResolver({
      cache,
      list: { path: '/api/payload-redirects/list' },
      trackHits: false,
    })

    // The very first request in a cold region must still redirect — that is the
    // whole point, versus the old behaviour of returning null and rebuilding
    // somewhere the reader cannot see.
    const ctx = fakeCtx()
    expect(await resolver('https://site.com/old', ctx)).toEqual({
      destination: '/new',
      redirect: entry(),
      status: 301,
    })
    expect(firstUrl(fetchMock)).toBe('https://site.com/api/payload-redirects/list')

    // …and the local cache is seeded, so the region stops missing.
    await Promise.all(ctx.tasks)
    expect(await cache.get()).toEqual([entry()])
  })

  it('runs with no cache at all, bounded by the memo', async () => {
    const fetchMock = listFetch([entry()])
    vi.stubGlobal('fetch', fetchMock)

    // `cache` is optional: the list route is the source of truth, so omitting a
    // store is a valid config — every memo expiry just costs a fetch.
    const resolver = createRedirectsResolver({
      cacheMemoMs: 60_000,
      list: { path: '/list' },
      trackHits: false,
    })

    const ctx = fakeCtx()
    expect(await resolver('https://site.com/old', ctx)).toEqual({
      destination: '/new',
      redirect: entry(),
      status: 301,
    })
    await Promise.all(ctx.tasks)
    expect(urlsOf(fetchMock)).toEqual(['https://site.com/list'])

    // Inside the memo window the list is not re-fetched, and nothing throws for
    // want of a cache to seed.
    fetchMock.mockClear()
    expect(await resolver('https://site.com/old')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads through with an explicit path even when the endpoint is disabled', async () => {
    const fetchMock = listFetch([entry()])
    vi.stubGlobal('fetch', fetchMock)

    // The "I serve the list myself" setup: `disabled` stops the plugin
    // registering its endpoint, an explicit `path` still names the origin. This
    // silently killed the read-through once — the exact multi-region bug back.
    const resolver = createRedirectsResolver({
      cache: memoryCache(),
      list: { disabled: true, path: '/api/my-redirects/list' },
      trackHits: false,
    })

    expect(await resolver('https://site.com/old')).not.toBeNull()
    expect(urlsOf(fetchMock)).toEqual(['https://site.com/api/my-redirects/list'])
  })

  it('reads through when the cache backend throws, without trying to seed it', async () => {
    const fetchMock = listFetch([entry()])
    vi.stubGlobal('fetch', fetchMock)

    const set = vi.fn(() => Promise.resolve())
    const resolver = createRedirectsResolver({
      // A misconfigured accelerator (bad token, missing binding) must not take
      // correctness down with it — the origin is still reachable.
      cache: { get: () => Promise.reject(new Error('EDGE_CONFIG missing')), set },
      list: { path: '/list' },
      trackHits: false,
    })

    const ctx = fakeCtx()
    expect(await resolver('https://site.com/old', ctx)).toEqual({
      destination: '/new',
      redirect: entry(),
      status: 301,
    })
    await Promise.all(ctx.tasks)
    // Seeding a store that is already throwing would be pointless noise.
    expect(set).not.toHaveBeenCalled()
  })

  it('collapses concurrent misses into a single list fetch', async () => {
    const fetchMock = listFetch([entry()])
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({
      cache: memoryCache(),
      cacheMemoMs: 0,
      list: { path: '/list' },
      trackHits: false,
    })

    const results = await Promise.all([
      resolver('https://site.com/old'),
      resolver('https://site.com/old'),
      resolver('https://site.com/old'),
    ])

    expect(results.every((result) => result?.status === 301)).toBe(true)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/list'))).toHaveLength(
      1,
    )
  })

  it('sends the shared secret and honours an absolute list URL', async () => {
    const fetchMock = listFetch([entry()])
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({
      cache: memoryCache(),
      list: { path: 'https://cms.example.com/api/payload-redirects/list' },
      secret: 'sh',
      trackHits: false,
    })

    expect((await resolver('https://site.com/old'))?.status).toBe(301)
    expect(firstUrl(fetchMock)).toBe('https://cms.example.com/api/payload-redirects/list')
    expect(
      headerOf(
        (fetchMock.mock.calls[0] as unknown as [URL, RequestInit | undefined])[1],
        'x-payload-redirects-secret',
      ),
    ).toBe('sh')
  })

  it('never falls back to the refresh POST when the list route fails', async () => {
    const fetchMock = vi.fn((input: string | URL, _init?: RequestInit) =>
      String(input).includes('/list')
        ? Promise.resolve(new Response('nope', { status: 500 }))
        : Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const resolver = createRedirectsResolver({ cache: memoryCache(), list: { path: '/list' } })
    const ctx = fakeCtx()
    expect(await resolver('https://site.com/old', ctx)).toBeNull()

    // The refresh rebuilds wherever Payload runs, which this region may not see;
    // under an origin outage it only adds a cold start per miss.
    await Promise.all(ctx.tasks)
    expect(urlsOf(fetchMock)).toEqual(['https://site.com/list'])
  })

  it('backs off the list route after a failure, doubling, until a read succeeds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)

    let listUp = false
    const fetchMock = vi.fn((input: string | URL, _init?: RequestInit) =>
      Promise.resolve(
        String(input).includes('/list') && listUp
          ? new Response(JSON.stringify({ redirects: [entry()] }), { status: 200 })
          : new Response('nope', { status: 500 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const listCalls = () => urlsOf(fetchMock).filter((url) => url.includes('/list')).length

    // No store, no memo: every request is a miss, so each one would read through.
    const resolver = createRedirectsResolver({
      cacheMemoMs: 0,
      list: { path: '/list' },
      trackHits: false,
    })

    // The first failure: the request passes through, and the origin rests 1s.
    expect(await resolver('https://site.com/old')).toBeNull()
    expect(listCalls()).toBe(1)

    // A burst inside the window passes through without asking the origin again.
    for (let index = 0; index < 50; index++) {
      expect(await resolver('https://site.com/old')).toBeNull()
    }
    expect(listCalls()).toBe(1)

    // After 1s it tries once more; a second failure doubles the wait to 2s.
    vi.setSystemTime(1000)
    expect(await resolver('https://site.com/old')).toBeNull()
    expect(listCalls()).toBe(2)
    vi.setSystemTime(2999)
    expect(await resolver('https://site.com/old')).toBeNull()
    expect(listCalls()).toBe(2)

    // A malformed body is a failure too: 4s.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ redirects: 'nope' }), { status: 200 })),
    )
    vi.setSystemTime(3000)
    expect(await resolver('https://site.com/old')).toBeNull()
    expect(listCalls()).toBe(3)

    // The waits stop doubling at 30s.
    for (const at of [7000, 15_000, 31_000, 61_000]) {
      vi.setSystemTime(at - 1)
      await resolver('https://site.com/old')
      const before = listCalls()
      vi.setSystemTime(at)
      await resolver('https://site.com/old')
      expect(listCalls()).toBe(before + 1)
    }
    vi.setSystemTime(91_000)
    await resolver('https://site.com/old')
    expect(listCalls()).toBe(8)

    // The origin is back: the next attempt redirects, and resets the back-off.
    listUp = true
    vi.setSystemTime(121_000)
    expect((await resolver('https://site.com/old'))?.status).toBe(301)
    expect(listCalls()).toBe(9)

    // So a later failure starts again at 1s, not 30s.
    listUp = false
    await resolver('https://site.com/old')
    expect(listCalls()).toBe(10)
    vi.setSystemTime(122_000)
    await resolver('https://site.com/old')
    expect(listCalls()).toBe(11)
  })

  it('resets the back-off when the cache answers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)

    const fetchMock = vi.fn((_input: string | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('nope', { status: 500 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const cache = memoryCache()
    const resolver = createRedirectsResolver({
      cache,
      cacheMemoMs: 0,
      list: { path: '/list' },
      trackHits: false,
    })

    // Fail three times: the next attempt is 4s away.
    for (const at of [0, 1000, 3000]) {
      vi.setSystemTime(at)
      await resolver('https://site.com/old')
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // A plugin write lands in this region's store; the next read hits it.
    await cache.set([entry()])
    expect((await resolver('https://site.com/old'))?.status).toBe(301)

    // Emptied again, the next miss reads through at once and backs off 1s.
    await cache.set(null as unknown as CachedRedirect[])
    await resolver('https://site.com/old')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    vi.setSystemTime(4000)
    await resolver('https://site.com/old')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('ignores a malformed list payload and never fetches when the list is disabled', async () => {
    const malformed = listFetch('not-an-array')
    vi.stubGlobal('fetch', malformed)
    const resolver = createRedirectsResolver({
      cache: memoryCache(),
      list: { path: '/list' },
      refreshOnMiss: false,
    })
    expect(await resolver('https://site.com/old')).toBeNull()

    // Individual bad entries are dropped, the good ones survive.
    const mixed = listFetch([{ junk: true }, entry()])
    vi.stubGlobal('fetch', mixed)
    const lenient = createRedirectsResolver({
      cache: memoryCache(),
      list: { path: '/list' },
      trackHits: false,
    })
    expect((await lenient('https://site.com/old'))?.status).toBe(301)

    // list: { disabled: true } opts out — no list request at all.
    const quiet = listFetch([entry()])
    vi.stubGlobal('fetch', quiet)
    const optedOut = createRedirectsResolver({
      cache: memoryCache(),
      list: { disabled: true },
      refreshOnMiss: false,
    })
    expect(await optedOut('https://site.com/old')).toBeNull()
    expect(quiet).not.toHaveBeenCalled()
  })
})

describe('createRedirectsRequestHandler', () => {
  it('answers a matching Request with a Response redirect', async () => {
    const handler = createRedirectsRequestHandler({
      cache: await primedCache([entry(), entry({ id: '2', from: '/temp', status: 302, to: '/x' })]),
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

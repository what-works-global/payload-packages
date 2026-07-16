import type { NextFetchEvent } from 'next/server'

import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CachedRedirect, RedirectsCache } from '../src/exports/middleware.js'

import { memoryCache } from '../src/exports/cache.js'
import { createRedirectsMiddleware } from '../src/exports/middleware.js'

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

type FakeEvent = { tasks: Promise<unknown>[]; waitUntil: (task: Promise<unknown>) => void }

const fakeEvent = (): FakeEvent => {
  const tasks: Promise<unknown>[] = []
  return {
    tasks,
    waitUntil: (task) => {
      tasks.push(task)
    },
  }
}

const asEvent = (event: FakeEvent) => event as unknown as NextFetchEvent

const request = (url: string) => new NextRequest(url)

const okFetch = () =>
  vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  )

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createRedirectsMiddleware', () => {
  it('redirects a matching request with the configured status code', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([entry(), entry({ id: '2', type: '302', from: '/temp', to: '/x' })]),
      trackHits: false,
    })

    const permanent = await middleware(request('https://site.com/old'))
    expect(permanent?.status).toBe(301)
    expect(permanent?.headers.get('location')).toBe('https://site.com/new')

    const temporary = await middleware(request('https://site.com/temp'))
    expect(temporary?.status).toBe(302)
    expect(temporary?.headers.get('location')).toBe('https://site.com/x')

    expect(await middleware(request('https://site.com/unmatched'))).toBeUndefined()
  })

  it('normalizes trailing slashes and falls back to the bare path with a query', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([entry()]),
      trackHits: false,
    })

    expect((await middleware(request('https://site.com/old/')))?.status).toBe(301)
    expect((await middleware(request('https://site.com/old?utm=x')))?.status).toBe(301)
  })

  it('preserves scrollTo fragments and absolute destinations', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([
        entry({ to: '/about#team' }),
        entry({ id: '2', from: '/ext', to: 'https://elsewhere.com/page' }),
      ]),
      trackHits: false,
    })

    expect((await middleware(request('https://site.com/old')))?.headers.get('location')).toBe(
      'https://site.com/about#team',
    )
    expect((await middleware(request('https://site.com/ext')))?.headers.get('location')).toBe(
      'https://elsewhere.com/page',
    )
  })

  it('substitutes regex capture groups', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([entry({ from: '^/blog/(.+)$', match: 'regex', to: '/news/$1' })]),
      trackHits: false,
    })

    const response = await middleware(request('https://site.com/blog/hello-world'))
    expect(response?.headers.get('location')).toBe('https://site.com/news/hello-world')
  })

  it('matches startsWith / endsWith / contains, case-insensitively', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([
        entry({ caseInsensitive: true, from: '/Blog', match: 'startsWith', to: '/news' }),
        entry({ id: '2', caseInsensitive: true, from: '.HTML', match: 'endsWith', to: '/clean' }),
        entry({ id: '3', caseInsensitive: true, from: 'ADMIN', match: 'contains', to: '/denied' }),
      ]),
      trackHits: false,
    })

    expect((await middleware(request('https://site.com/blog/post')))?.headers.get('location')).toBe(
      'https://site.com/news',
    )
    expect((await middleware(request('https://site.com/page.html')))?.headers.get('location')).toBe(
      'https://site.com/clean',
    )
    expect(
      (await middleware(request('https://site.com/some/admin/page')))?.headers.get('location'),
    ).toBe('https://site.com/denied')
    // Case-insensitive off would still match here because the request is lower;
    // a request that only differs in case must still match when CI is on.
    expect((await middleware(request('https://site.com/BLOG/x')))?.status).toBe(301)
  })

  it('forwards the request query when forwardQuery is set (destination params win)', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([
        entry({ forwardQuery: true }),
        entry({ id: '2', forwardQuery: true, from: '/keep', to: '/dest?ref=keep' }),
      ]),
      trackHits: false,
    })

    expect(
      (await middleware(request('https://site.com/old?ref=abc')))?.headers.get('location'),
    ).toBe('https://site.com/new?ref=abc')

    expect(
      (await middleware(request('https://site.com/keep?ref=abc&extra=1')))?.headers.get('location'),
    ).toBe('https://site.com/dest?ref=keep&extra=1')
  })

  it('rejects open-redirect escapes end-to-end', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([entry({ from: '^/r/(.+)$', match: 'regex', to: '/$1' })]),
      trackHits: false,
    })

    // `/r//evil.com` → `//evil.com`, which browsers treat as a protocol-relative
    // URL to another origin. resolveRedirect must skip it → no redirect.
    expect(await middleware(request('https://site.com/r//evil.com'))).toBeUndefined()
    // A safe capture still redirects.
    expect((await middleware(request('https://site.com/r/docs')))?.headers.get('location')).toBe(
      'https://site.com/docs',
    )
  })

  it('skips self-redirects, including fragment-only differences', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([
        // Fragments never reach the server, so this would loop if not skipped.
        entry({ from: '/pricing', to: '/pricing#plans' }),
        entry({ id: '2', from: '^/loop/(.+)$', match: 'regex', to: '/loop/$1' }),
      ]),
      trackHits: false,
    })

    expect(await middleware(request('https://site.com/pricing'))).toBeUndefined()
    expect(await middleware(request('https://site.com/loop/x'))).toBeUndefined()
  })

  it('tracks hits through the plugin endpoint', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const middleware = createRedirectsMiddleware({
      apiBasePath: '/api/payload',
      cache: await primedCache([entry({ id: 'abc' })]),
    })

    const event = fakeEvent()
    const response = await middleware(request('https://site.com/old'), asEvent(event))
    expect(response?.status).toBe(301)

    await Promise.all(event.tasks)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [hitUrl, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(hitUrl)).toBe('https://site.com/api/payload/payload-redirects/hit/abc')
    expect(init.method).toBe('POST')
  })

  it('sends the secret header on hit and refresh requests when configured', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const withHits = createRedirectsMiddleware({
      cache: await primedCache([entry({ id: 'abc' })]),
      secret: 'sesame',
    })
    const hitEvent = fakeEvent()
    await withHits(request('https://site.com/old'), asEvent(hitEvent))
    await Promise.all(hitEvent.tasks)
    const [, hitInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(headerOf(hitInit, 'x-payload-redirects-secret')).toBe('sesame')

    fetchMock.mockClear()

    const onMiss = createRedirectsMiddleware({ cache: memoryCache(), secret: 'sesame' })
    const missEvent = fakeEvent()
    await onMiss(request('https://site.com/old'), asEvent(missEvent))
    await Promise.all(missEvent.tasks)
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(refreshUrl)).toBe('https://site.com/api/payload-redirects/refresh-cache')
    expect(headerOf(refreshInit, 'x-payload-redirects-secret')).toBe('sesame')
  })

  it('omits the secret header when no secret is configured', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const middleware = createRedirectsMiddleware({
      cache: await primedCache([entry({ id: 'abc' })]),
    })
    const event = fakeEvent()
    await middleware(request('https://site.com/old'), asEvent(event))
    await Promise.all(event.tasks)
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.headers).toBeUndefined()
  })

  it('invokes onRedirect in the background and swallows its errors', async () => {
    const onRedirect = vi.fn(() => Promise.resolve())
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([entry({ id: 'abc' })]),
      onRedirect,
      trackHits: false,
    })

    const event = fakeEvent()
    const response = await middleware(request('https://site.com/old'), asEvent(event))
    expect(response?.status).toBe(301)

    await Promise.all(event.tasks)
    expect(onRedirect).toHaveBeenCalledTimes(1)
    const [args] = onRedirect.mock.calls[0] as unknown as [
      { destination: string; redirect: CachedRedirect; request: NextRequest },
    ]
    expect(args.destination).toBe('/new')
    expect(args.redirect.id).toBe('abc')
    expect(args.request).toBeInstanceOf(NextRequest)

    // A throwing hook must never break routing.
    const throwing = createRedirectsMiddleware({
      cache: await primedCache([entry()]),
      onRedirect: () => {
        throw new Error('hook boom')
      },
      trackHits: false,
    })
    const throwEvent = fakeEvent()
    const throwResponse = await throwing(request('https://site.com/old'), asEvent(throwEvent))
    expect(throwResponse?.status).toBe(301)
    await expect(Promise.all(throwEvent.tasks)).resolves.toBeDefined()
  })

  it('logs diagnostics when debug is enabled', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const matcher = createRedirectsMiddleware({
      cache: await primedCache([entry()]),
      debug: true,
      trackHits: false,
    })
    await matcher(request('https://site.com/old'))
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[payload-redirects] match /old'))

    debugSpy.mockClear()
    const misser = createRedirectsMiddleware({
      cache: memoryCache(),
      debug: true,
      refreshOnMiss: false,
    })
    await misser(request('https://site.com/old'))
    expect(debugSpy).toHaveBeenCalledWith('[payload-redirects] cache miss')
  })

  it('memoizes the cache read within cacheMemoMs', async () => {
    const get = vi.fn(() => Promise.resolve<CachedRedirect[] | null>([entry()]))
    const cache: RedirectsCache = { get, set: () => Promise.resolve() }

    const middleware = createRedirectsMiddleware({ cache, cacheMemoMs: 5000, trackHits: false })

    expect((await middleware(request('https://site.com/old')))?.status).toBe(301)
    expect((await middleware(request('https://site.com/old')))?.status).toBe(301)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('re-reads the cache on every request when memoization is off', async () => {
    const get = vi.fn(() => Promise.resolve<CachedRedirect[] | null>([entry()]))
    const cache: RedirectsCache = { get, set: () => Promise.resolve() }

    const middleware = createRedirectsMiddleware({ cache, cacheMemoMs: 0, trackHits: false })

    await middleware(request('https://site.com/old'))
    await middleware(request('https://site.com/old'))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('refreshes the cache in the background on a miss', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const middleware = createRedirectsMiddleware({ cache: memoryCache() })

    const event = fakeEvent()
    expect(await middleware(request('https://site.com/old'), asEvent(event))).toBeUndefined()

    await Promise.all(event.tasks)
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toBe(
      'https://site.com/api/payload-redirects/refresh-cache',
    )

    // An empty list is a valid cached state, not a miss.
    fetchMock.mockClear()
    const emptied = createRedirectsMiddleware({ cache: await primedCache([]) })
    expect(await emptied(request('https://site.com/old'), asEvent(fakeEvent()))).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()

    // …and refreshOnMiss: false stays quiet entirely.
    const disabled = createRedirectsMiddleware({ cache: memoryCache(), refreshOnMiss: false })
    expect(await disabled(request('https://site.com/old'), asEvent(fakeEvent()))).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filters malformed cached entries and survives cache errors', async () => {
    const cache = memoryCache()
    await cache.set([{ junk: true } as unknown as CachedRedirect, entry()])
    const middleware = createRedirectsMiddleware({ cache, trackHits: false })
    expect((await middleware(request('https://site.com/old')))?.status).toBe(301)

    const broken = createRedirectsMiddleware({
      cache: {
        get: () => Promise.reject(new Error('backend down')),
        set: () => Promise.resolve(),
      },
    })
    expect(await broken(request('https://site.com/old'))).toBeUndefined()
  })
})

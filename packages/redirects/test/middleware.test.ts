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

afterEach(() => {
  vi.unstubAllGlobals()
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
      cache: await primedCache([entry({ from: '^/blog/(.+)$', regex: true, to: '/news/$1' })]),
      trackHits: false,
    })

    const response = await middleware(request('https://site.com/blog/hello-world'))
    expect(response?.headers.get('location')).toBe('https://site.com/news/hello-world')
  })

  it('skips self-redirects, including fragment-only differences', async () => {
    const middleware = createRedirectsMiddleware({
      cache: await primedCache([
        // Fragments never reach the server, so this would loop if not skipped.
        entry({ from: '/pricing', to: '/pricing#plans' }),
        entry({ id: '2', from: '^/loop/(.+)$', regex: true, to: '/loop/$1' }),
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

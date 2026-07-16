import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CachedRedirect, RedirectsCache } from '../src/exports/cache.js'

import {
  cloudflareKVCache,
  envCache,
  fileCache,
  memoryCache,
  redisCache,
} from '../src/exports/cache.js'
import { edgeConfigCache } from '../src/exports/edge-config.js'
import { vercelRuntimeCache } from '../src/exports/vercel.js'

const entry = (overrides: Partial<CachedRedirect> = {}): CachedRedirect => ({
  id: '1',
  type: '301',
  from: '/old',
  to: '/new',
  ...overrides,
})

const runtimeStore = new Map<string, unknown>()
vi.mock('@vercel/functions', () => ({
  getCache: () => ({
    get: (key: string) => Promise.resolve(runtimeStore.get(key) ?? null),
    set: (key: string, value: unknown) => {
      runtimeStore.set(key, value)
      return Promise.resolve()
    },
  }),
}))

const edgeConfigStore = new Map<string, unknown>()
vi.mock('@vercel/edge-config', () => ({
  createClient: () => ({
    get: (key: string) => Promise.resolve(edgeConfigStore.get(key)),
  }),
}))

afterEach(() => {
  runtimeStore.clear()
  edgeConfigStore.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('memoryCache', () => {
  it('round-trips and starts as a miss', async () => {
    const cache = memoryCache()
    expect(await cache.get()).toBeNull()
    await cache.set([entry()])
    expect(await cache.get()).toEqual([entry()])
  })
})

describe('fileCache', () => {
  it('round-trips through a JSON file and misses before the first write', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-redirects-cache-'))
    const cache = fileCache({ path: path.join(dir, 'nested', 'cache.json') })

    expect(await cache.get()).toBeNull()
    await cache.set([entry(), entry({ id: '2', from: '/a', to: '/b' })])
    expect(await cache.get()).toHaveLength(2)

    await cache.set([entry({ id: '3' })])
    expect(await cache.get()).toEqual([entry({ id: '3' })])
  })

  it('treats corrupt or foreign files as misses and filters malformed entries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-redirects-cache-'))
    const target = path.join(dir, 'cache.json')
    const cache = fileCache({ path: target })

    fs.writeFileSync(target, 'not json')
    expect(await cache.get()).toBeNull()

    fs.writeFileSync(target, JSON.stringify({ something: 'else' }))
    expect(await cache.get()).toBeNull()

    fs.writeFileSync(target, JSON.stringify({ redirects: [entry(), { broken: true }] }))
    expect(await cache.get()).toEqual([entry()])
  })
})

describe('vercelRuntimeCache', () => {
  it('uses the runtime cache outside development', async () => {
    const cache = vercelRuntimeCache()
    expect(await cache.get()).toBeNull()
    await cache.set([entry()])
    expect(runtimeStore.get('payload-redirects')).toEqual([entry()])
    expect(await cache.get()).toEqual([entry()])
  })

  it('stores under a custom key and filters malformed cached values', async () => {
    const cache = vercelRuntimeCache({ key: 'custom-key' })
    runtimeStore.set('custom-key', [entry(), { junk: true }])
    expect(await cache.get()).toEqual([entry()])
    runtimeStore.set('custom-key', 'not-an-array')
    expect(await cache.get()).toBeNull()
  })
})

const fakeRedis = (mode: 'parsed' | 'string') => {
  const store = new Map<string, string>()
  return {
    get: vi.fn((key: string): Promise<unknown> => {
      const raw = store.get(key)
      if (raw === undefined) {
        return Promise.resolve(null)
      }
      return Promise.resolve(mode === 'string' ? raw : JSON.parse(raw))
    }),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve('OK')
    }),
    store,
  }
}

describe('redisCache', () => {
  it('round-trips through a JSON string client (ioredis / node-redis)', async () => {
    const client = fakeRedis('string')
    const cache = redisCache({ client })

    expect(await cache.get()).toBeNull()
    await cache.set([entry()])
    expect(client.set).toHaveBeenCalledWith('payload-redirects', JSON.stringify([entry()]))
    expect(await cache.get()).toEqual([entry()])
  })

  it('accepts an already-parsed array and filters malformed entries (Upstash)', async () => {
    const client = fakeRedis('parsed')
    const cache = redisCache({ client, key: 'rd' })

    client.store.set('rd', JSON.stringify([entry(), { junk: true }]))
    expect(client.get).not.toHaveBeenCalled()
    expect(await cache.get()).toEqual([entry()])
    expect(client.get).toHaveBeenCalledWith('rd')
  })

  it('treats a malformed string as a miss', async () => {
    const client = fakeRedis('string')
    const cache = redisCache({ client })
    client.store.set('payload-redirects', 'not json')
    expect(await cache.get()).toBeNull()
  })
})

const fakeKVNamespace = () => {
  const store = new Map<string, string>()
  return {
    get: vi.fn(
      (key: string, _type: 'text'): Promise<null | string> =>
        Promise.resolve(store.get(key) ?? null),
    ),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve()
    }),
    store,
  }
}

describe('cloudflareKVCache', () => {
  it('round-trips through the KV namespace and filters malformed entries', async () => {
    const namespace = fakeKVNamespace()
    const cache = cloudflareKVCache({ namespace })

    expect(await cache.get()).toBeNull()
    await cache.set([entry()])
    expect(namespace.put).toHaveBeenCalledWith('payload-redirects', JSON.stringify([entry()]))
    expect(namespace.get).toHaveBeenCalledWith('payload-redirects', 'text')
    expect(await cache.get()).toEqual([entry()])

    namespace.store.set('payload-redirects', JSON.stringify([entry(), { junk: true }]))
    expect(await cache.get()).toEqual([entry()])
  })

  it('treats a malformed value as a miss and honours a custom key', async () => {
    const namespace = fakeKVNamespace()
    const cache = cloudflareKVCache({ key: 'kv', namespace })
    namespace.store.set('kv', 'not json')
    expect(await cache.get()).toBeNull()
  })
})

describe('edgeConfigCache', () => {
  it('reads and filters from the edge config client', async () => {
    edgeConfigStore.set('payload-redirects', [entry(), { junk: true }])
    const cache = edgeConfigCache({ edgeConfigId: 'ecfg_1', token: 't' })
    expect(await cache.get()).toEqual([entry()])
  })

  it('returns null when the item is absent or not an array', async () => {
    const cache = edgeConfigCache({ edgeConfigId: 'ecfg_1', token: 't' })
    expect(await cache.get()).toBeNull()
    edgeConfigStore.set('payload-redirects', 'nope')
    expect(await cache.get()).toBeNull()
  })

  it('writes via the Vercel REST API with the expected URL, headers and body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const cache = edgeConfigCache({
      edgeConfigId: 'ecfg_1',
      itemKey: 'ph',
      teamId: 'team_9',
      token: 'tok',
    })
    await cache.set([entry()])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.vercel.com/v1/edge-config/ecfg_1/items?teamId=team_9')
    expect(init.method).toBe('PATCH')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ key: 'ph', operation: 'upsert', value: [entry()] }],
    })
  })

  it('throws when the write fails', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('denied', { status: 401 })))
    vi.stubGlobal('fetch', fetchMock)

    const cache = edgeConfigCache({ edgeConfigId: 'ecfg_1', token: 't' })
    await expect(cache.set([entry()])).rejects.toThrow(/401/)
  })
})

describe('envCache', () => {
  const seeded = async (id: string): Promise<RedirectsCache> => {
    const cache = memoryCache()
    await cache.set([entry({ id })])
    return cache
  }

  it('selects the development branch under NODE_ENV=development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const cache = envCache({
      development: await seeded('dev'),
      production: await seeded('prod'),
    })
    expect(await cache.get()).toEqual([entry({ id: 'dev' })])
  })

  it('selects the production branch otherwise', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const cache = envCache({
      development: await seeded('dev'),
      production: await seeded('prod'),
    })
    expect(await cache.get()).toEqual([entry({ id: 'prod' })])
  })

  it('honours a custom select (e.g. Vercel preview → development)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const cache = envCache({
      development: await seeded('dev'),
      production: await seeded('prod'),
      select: () => 'development',
    })
    expect(await cache.get()).toEqual([entry({ id: 'dev' })])
  })

  it('accepts plain cache instances and round-trips through the chosen one', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const production = memoryCache()

    const cache = envCache({ development: memoryCache(), production })
    await cache.set([entry({ id: 'written' })])
    expect(await production.get()).toEqual([entry({ id: 'written' })])
    expect(await cache.get()).toEqual([entry({ id: 'written' })])
  })

  it('invokes only the chosen branch thunk, exactly once', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const developmentThunk = vi.fn(() => memoryCache())
    const productionThunk = vi.fn(() => memoryCache())

    envCache({ development: developmentThunk, production: productionThunk })
    expect(productionThunk).toHaveBeenCalledTimes(1)
    expect(developmentThunk).not.toHaveBeenCalled()
  })

  it('logs once when the development branch engages, and is silent in production', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    vi.stubEnv('NODE_ENV', 'development')
    envCache({ development: memoryCache(), production: memoryCache() })
    expect(info).toHaveBeenCalledTimes(1)
    expect(String(info.mock.calls[0]?.[0])).toContain('development environment detected')

    info.mockClear()
    vi.stubEnv('NODE_ENV', 'production')
    envCache({ development: memoryCache(), production: memoryCache() })
    expect(info).not.toHaveBeenCalled()
  })

  it('defaults the development branch to a file cache without writing on read', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    // No `development` branch given → defaults to `fileCache()`. Reading a fresh
    // default file cache is a miss and writes nothing to `.next/cache`; the
    // production thunk must never run in development.
    const cache = envCache({
      production: () => {
        throw new Error('production branch must not be constructed in development')
      },
    })
    expect(await cache.get()).toBeNull()
  })
})

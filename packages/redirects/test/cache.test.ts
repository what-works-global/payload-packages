import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CachedRedirect, RedirectsCache } from '../src/exports/cache.js'

import { fileCache, memoryCache } from '../src/exports/cache.js'
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

afterEach(() => {
  runtimeStore.clear()
  vi.unstubAllEnvs()
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

  it('delegates to the development cache while NODE_ENV is development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const store: { entries: CachedRedirect[] | null } = { entries: null }
    const development: RedirectsCache = {
      get: () => Promise.resolve(store.entries),
      set: (redirects) => {
        store.entries = redirects
        return Promise.resolve()
      },
    }

    const cache = vercelRuntimeCache({ development })
    await cache.set([entry()])
    expect(store.entries).toEqual([entry()])
    expect(runtimeStore.size).toBe(0)
    expect(await cache.get()).toEqual([entry()])
  })

  it('ignores NODE_ENV when the development cache is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const cache = vercelRuntimeCache({ development: false })
    await cache.set([entry()])
    expect(runtimeStore.get('payload-redirects')).toEqual([entry()])
  })
})

import { describe, expect, it, vi } from 'vitest'

import { createMemoryCache, noopCache, sitemapCacheTag } from '../src/core/cache.js'

describe('createMemoryCache', () => {
  it('caches wrap results per key and regenerates after invalidation', async () => {
    const cache = createMemoryCache()
    const fn = vi.fn(() => Promise.resolve([{ loc: 'https://example.com/' }]))

    await cache.wrap('pages', fn)
    await cache.wrap('pages', fn)
    expect(fn).toHaveBeenCalledTimes(1)

    await cache.wrap('posts', fn)
    expect(fn).toHaveBeenCalledTimes(2)

    await cache.invalidate(['pages'])
    await cache.wrap('pages', fn)
    expect(fn).toHaveBeenCalledTimes(3)

    // 'posts' was not invalidated
    await cache.wrap('posts', fn)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('noopCache', () => {
  it('never caches', async () => {
    const fn = vi.fn(() => Promise.resolve([]))
    await noopCache.wrap('pages', fn)
    await noopCache.wrap('pages', fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('sitemapCacheTag', () => {
  it('namespaces group tags', () => {
    expect(sitemapCacheTag('pages')).toBe('payload-sitemap:pages')
  })
})

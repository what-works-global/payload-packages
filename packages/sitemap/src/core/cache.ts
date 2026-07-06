import type { SitemapCache, SitemapEntry, SitemapPluginConfig } from '../types.js'

export const SITEMAP_CACHE_TAG = 'payload-sitemap'

export const sitemapCacheTag = (group: string): string => `${SITEMAP_CACHE_TAG}:${group}`

export const createMemoryCache = (): SitemapCache => {
  const store = new Map<string, SitemapEntry[]>()
  return {
    invalidate(keys) {
      for (const key of keys) {
        store.delete(key)
      }
    },
    async wrap(key, fn) {
      const cached = store.get(key)
      if (cached) {
        return cached
      }
      const entries = await fn()
      store.set(key, entries)
      return entries
    },
  }
}

export const noopCache: SitemapCache = {
  invalidate: () => {},
  wrap: (_key, fn) => fn(),
}

type NextCacheModule = {
  revalidateTag?: (tag: string, profile?: unknown) => void
  unstable_cache?: <T>(
    fn: () => Promise<T>,
    keyParts: string[],
    options: { revalidate: false; tags: string[] },
  ) => () => Promise<T>
}

let nextCachePromise: Promise<NextCacheModule | null> | undefined

const loadNextCache = (): Promise<NextCacheModule | null> => {
  nextCachePromise ??= import('next/cache').then(
    (mod) => mod as NextCacheModule,
    () => null,
  )
  return nextCachePromise
}

/**
 * Caches entries in the Next.js Data Cache tagged `payload-sitemap:<group>`, so
 * invalidation is `revalidateTag` — shared across serverless instances on Vercel.
 * Degrades to uncached execution when `next/cache` is unavailable or errors
 * (standalone Payload, seed scripts, non-request contexts).
 */
export const createNextTagsCache = (): SitemapCache => ({
  async invalidate(keys) {
    const mod = await loadNextCache()
    if (!mod?.revalidateTag) {
      return
    }
    for (const key of keys) {
      try {
        // Next 16 requires a cache profile to expire instantly; Next 15's
        // single-argument revalidateTag ignores the extra argument.
        mod.revalidateTag(sitemapCacheTag(key), { expire: 0 })
      } catch {
        // Outside a Next request scope (scripts, workers) there is nothing to invalidate.
      }
    }
  },
  async wrap(key, fn) {
    const mod = await loadNextCache()
    if (!mod?.unstable_cache) {
      return fn()
    }
    try {
      return await mod.unstable_cache(fn, [SITEMAP_CACHE_TAG, key], {
        revalidate: false,
        tags: [SITEMAP_CACHE_TAG, sitemapCacheTag(key)],
      })()
    } catch {
      return fn()
    }
  },
})

/** Next tag cache when `next/cache` is importable, in-memory otherwise. */
export const createAutoCache = (): SitemapCache => {
  const memory = createMemoryCache()
  const nextTags = createNextTagsCache()
  const pick = async (): Promise<SitemapCache> => ((await loadNextCache()) ? nextTags : memory)
  return {
    invalidate: async (keys) => (await pick()).invalidate(keys),
    wrap: async (key, fn) => (await pick()).wrap(key, fn),
  }
}

export const resolveCache = (option: SitemapPluginConfig['cache']): SitemapCache => {
  if (option === 'memory') {
    return createMemoryCache()
  }
  if (option === 'none') {
    return noopCache
  }
  if (option === 'auto' || option === undefined) {
    return createAutoCache()
  }
  return option
}

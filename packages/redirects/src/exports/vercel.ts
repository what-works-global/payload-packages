/**
 * The Vercel Runtime Cache adapter lives in its own entry point because
 * `@vercel/functions` is an optional peer dependency: bundlers resolve even
 * dynamic `import()`s with literal specifiers at build time, so referencing
 * the package from the shared `/cache` entry would force every consumer —
 * including ones only using `fileCache`/`memoryCache` — to install it.
 * Importing this module states the intent, so the dependency is imported
 * statically and must be installed.
 */
import { getCache } from '@vercel/functions'

import type { RedirectsCache } from '../core/shared.js'

import { isCachedRedirect } from '../core/shared.js'
import { fileCache } from './cache.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type VercelRuntimeCacheOptions = {
  /**
   * Cache used instead of the runtime cache while `NODE_ENV === 'development'`,
   * where the Vercel Runtime Cache is unavailable. Pass `false` to always use
   * the runtime cache.
   * @default fileCache()
   */
  development?: false | RedirectsCache
  /**
   * Runtime-cache key the redirect list is stored under. Change it when one
   * Vercel project hosts several Payload instances sharing a cache.
   * @default 'payload-redirects'
   */
  key?: string
  /**
   * Cache tags, for manual invalidation via the Vercel API/dashboard.
   * @default ['payload-redirects']
   */
  tags?: string[]
  /**
   * Freshness TTL in seconds. The runtime cache treats entries without a TTL
   * as never fresh — every read would miss — so a long TTL is the correct
   * default: the plugin re-syncs on every change, expiry is not relied on for
   * correctness.
   * @default one year
   */
  ttl?: number
}

/**
 * Vercel Runtime Cache (`getCache()` from `@vercel/functions`) — shared
 * across function and middleware invocations in one region, readable from
 * Vercel's middleware without invoking a function. In development it
 * delegates to the `development` cache (a `fileCache()` unless overridden),
 * since the runtime cache only exists on Vercel's infrastructure.
 */
export const vercelRuntimeCache = (options: VercelRuntimeCacheOptions = {}): RedirectsCache => {
  const {
    development,
    key = 'payload-redirects',
    tags = ['payload-redirects'],
    ttl = 60 * 60 * 24 * 365,
  } = options

  const developmentCache = development === false ? undefined : (development ?? fileCache())
  const pickDevelopment = () =>
    process.env.NODE_ENV === 'development' ? developmentCache : undefined

  let runtimeCache: ReturnType<typeof getCache> | undefined
  const getRuntimeCache = () => {
    runtimeCache ??= getCache()
    return runtimeCache
  }

  return {
    get: async () => {
      const dev = pickDevelopment()
      if (dev) {
        return dev.get()
      }
      const value = await getRuntimeCache().get(key)
      if (!Array.isArray(value)) {
        return null
      }
      return value.filter(isCachedRedirect)
    },
    set: async (redirects) => {
      const dev = pickDevelopment()
      if (dev) {
        return dev.set(redirects)
      }
      await getRuntimeCache().set(key, redirects, { tags, ttl })
    },
  }
}

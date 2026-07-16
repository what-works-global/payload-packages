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

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type VercelRuntimeCacheOptions = {
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
 * Vercel Runtime Cache (`getCache()` from `@vercel/functions`) — shared across
 * function and middleware invocations in one region, readable from Vercel's
 * middleware without invoking a function. This adapter is environment-dumb: it
 * always talks to the runtime cache, which only exists on Vercel's
 * infrastructure. For a local `next dev` fallback, compose it with `envCache`
 * from `@whatworks/payload-redirects/cache`:
 * `envCache({ development: fileCache(), production: vercelRuntimeCache() })`.
 */
export const vercelRuntimeCache = (options: VercelRuntimeCacheOptions = {}): RedirectsCache => {
  const {
    key = 'payload-redirects',
    tags = ['payload-redirects'],
    ttl = 60 * 60 * 24 * 365,
  } = options

  let runtimeCache: ReturnType<typeof getCache> | undefined
  const getRuntimeCache = () => {
    runtimeCache ??= getCache()
    return runtimeCache
  }

  return {
    get: async () => {
      const value = await getRuntimeCache().get(key)
      if (!Array.isArray(value)) {
        return null
      }
      return value.filter(isCachedRedirect)
    },
    set: async (redirects) => {
      await getRuntimeCache().set(key, redirects, { tags, ttl })
    },
  }
}

/**
 * The Vercel Runtime Cache adapter lives in its own entry point because
 * `@vercel/functions` is an optional peer dependency: bundlers resolve even
 * dynamic `import()`s with literal specifiers at build time, so referencing
 * the package from the shared `/cache` entry would force every consumer —
 * including ones only using `fileCache`/`memoryCache` — to install it.
 * Importing this module states the intent, so the dependency is imported
 * statically and must be installed.
 */
import { getCache, invalidateByTag } from '@vercel/functions'

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
   * Cache tags set on the entry, so a tag purge can reach it. **Must match
   * `list.tags`** — that is what {@link vercelInvalidate} is handed, and a
   * mismatch means the purge silently stops clearing this layer. Both default to
   * `'payload-redirects'`, so leaving them alone is correct.
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
 * Vercel Runtime Cache (`getCache()` from `@vercel/functions`) — the recommended
 * store on Vercel, and the fast layer in front of the list route.
 *
 * A hit is answered from within the function with no HTTP hop at all. The list
 * route sits behind it as the origin, and `list.invalidate` clears both in one
 * call, so there is nothing to keep in sync by hand.
 *
 * Two properties are worth understanding, because they are why this is a cache
 * and not a store of record:
 *
 * - **Regional.** Each Vercel region has its own isolated cache. Routing
 *   middleware runs near the visitor (in the Node runtime too — the runtime
 *   choice controls the sandbox, not the placement), while the Payload function
 *   that writes runs only in the project's function region. So writes land in one
 *   region and reads come from many.
 * - **Ephemeral.** Entries are subject to LRU eviction against a project-wide
 *   storage limit, whatever TTL you ask for, and there is no
 *   `stale-while-revalidate` equivalent — an expired or evicted entry is a hard
 *   miss.
 *
 * Neither matters, because a miss is not a missed redirect: the resolver reads
 * through to the list route, answers the request from it, and seeds this cache.
 * A cold region is correct on its very first request. (Historically this adapter
 * was used *without* an origin behind it, which is exactly the failure this
 * design removes — measured on a real deployment: twelve reading regions, one
 * writing region, a 26–42% hit rate, and roughly one wasted rebuild per read.)
 *
 * Set `list.disabled` and you are back to that failure mode, so only do it on a
 * genuinely single-region read path.
 *
 * This adapter is environment-dumb: it always talks to the runtime cache, which
 * only exists on Vercel's infrastructure. For a local `next dev` fallback,
 * compose it with `envCache` from `@whatworks/payload-redirects/cache`:
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

/**
 * Purge hook for `list.invalidate` — the whole invalidation story on Vercel, in
 * one function.
 *
 * A tag purge on Vercel clears the **CDN cache, the Runtime Cache, and the Data
 * Cache together**, in every region, propagating globally in roughly 300ms. So
 * this single call invalidates both cached layers at once: the CDN copies of the
 * list route AND every region's {@link vercelRuntimeCache} entry — provided both
 * carry the same tags, which they do by default (`list.tags` is handed to this
 * function, and the adapter defaults to the same tag).
 *
 * Safe to wire up unconditionally: `invalidateByTag` resolves the purge API from
 * the ambient Vercel context and returns a resolved promise when there is none,
 * so this is a silent no-op during local development and on other platforms. It
 * needs no environment gate.
 *
 * It *invalidates* rather than deletes, so entries are marked stale instead of
 * dropped: the next request is answered instantly from the stale copy while the
 * revalidation happens behind it. No stampede, no latency spike.
 *
 * With this wired up, `list.maxAge` no longer carries freshness on its own, so
 * raise it — a year is reasonable. The origin then only sees a request per region
 * per edit, and the delay a visitor actually experiences is `cacheMemoMs` (the
 * in-process memo is the one layer no purge can reach).
 *
 * ```ts
 * import { defineRedirectsConfig } from '@whatworks/payload-redirects'
 * import { envCache, fileCache } from '@whatworks/payload-redirects/cache'
 * import { vercelInvalidate, vercelRuntimeCache } from '@whatworks/payload-redirects/vercel'
 *
 * export const redirectsConfig = defineRedirectsConfig({
 *   cache: envCache({ development: fileCache(), production: vercelRuntimeCache() }),
 *   list: { invalidate: vercelInvalidate, maxAge: 60 * 60 * 24 * 365 },
 * })
 * ```
 */
export const vercelInvalidate = async (tags: string[]): Promise<void> => {
  await invalidateByTag(tags)
}

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache.js'

/**
 * Config-side Next.js sugar — the pieces you wire into `payload.config.ts`:
 * {@link nextPathsPlugin}, {@link nextPathsCache}, and
 * {@link revalidatePathsOnChange}. These need only `next/cache`
 * (`unstable_cache`/`revalidateTag`/`revalidatePath`), never `next/navigation`
 * or `next/headers`.
 *
 * Why a separate entry from `@whatworks/payload-paths/next`: a Payload config is
 * imported by the REST route handlers (`app/api/[...]/route.ts`), which Next
 * bundles as `app-route` route modules. `next/navigation` (used by the
 * request-time resolver in `/next`) resolves an `app-router-context` that Next
 * only vendors for `app-page`/`pages` — not `app-route` — so importing anything
 * from `/next` into the config crashes the API with `MODULE_UNPARSABLE`. This
 * entry keeps `next/navigation` out of the config's module graph entirely.
 */
import type { PathsCache } from '../core/shared.js'
import type { OnPathChanged, PathsPluginConfig } from '../types.js'

import { pathsPlugin } from '../plugin.js'

export type { OnPathChanged, PathChangedEvent, PathsPluginConfig } from '../types.js'

/**
 * `PathsCache` adapter backed by Next's data cache: lookups are memoized with
 * `unstable_cache` and dropped with `revalidateTag`. Works on Next 15 and 16,
 * self-hosted and on Vercel. Safe to construct anywhere (including
 * payload.config.ts loaded by CLI commands): calls outside a Next request
 * context degrade to warnings, never throws.
 */
export const nextPathsCache = (): PathsCache => ({
  invalidate: (tags) => {
    for (const tag of tags) {
      try {
        // Next 16 requires the profile argument ({ expire: 0 } = drop
        // immediately); Next 15's single-arg runtime ignores it.
        ;(revalidateTag as (tag: string, profile?: { expire?: number }) => void)(tag, {
          expire: 0,
        })
      } catch (error) {
        // Outside the Next runtime (payload run scripts, seeds) there is no
        // cache to invalidate — the warning keeps it observable.
        // eslint-disable-next-line no-console -- surface cache misconfiguration
        console.warn(`[payload-paths] revalidateTag("${tag}") failed:`, error)
      }
    }
  },
  wrap: (loader, { key, tags }) => unstable_cache(loader, key, { tags }),
})

/**
 * `onPathChanged` handler that revalidates the affected page URLs in Next's
 * full-route cache (ISR). Wired in automatically by {@link nextPathsPlugin}.
 */
export const revalidatePathsOnChange: OnPathChanged = ({ newUrl, previousUrl }) => {
  for (const url of [previousUrl, newUrl]) {
    if (url === null || url === undefined) {
      continue
    }
    try {
      revalidatePath(url)
    } catch (error) {
      // eslint-disable-next-line no-console -- surface cache misconfiguration
      console.warn(`[payload-paths] revalidatePath("${url}") failed:`, error)
    }
  }
}

/**
 * {@link pathsPlugin} with Next.js defaults: the `unstable_cache` adapter for
 * data-cache invalidation and `revalidatePath` on every path change for the
 * full-route cache. Zero extra wiring for the common Next + Payload app.
 * Explicit `cache`/`onPathChanged` options still win.
 */
export const nextPathsPlugin = (config: PathsPluginConfig): ReturnType<typeof pathsPlugin> => {
  const userHandlers = Array.isArray(config.onPathChanged)
    ? config.onPathChanged
    : config.onPathChanged
      ? [config.onPathChanged]
      : []

  return pathsPlugin({
    ...config,
    cache: config.cache ?? nextPathsCache(),
    onPathChanged: [revalidatePathsOnChange, ...userHandlers],
  })
}

/**
 * The Vercel Edge Config adapter lives in its own entry point because
 * `@vercel/edge-config` is an optional peer dependency: bundlers resolve even
 * dynamic `import()`s with literal specifiers at build time, so referencing the
 * package from the shared `/cache` entry would force every consumer — including
 * ones only using `fileCache`/`memoryCache` — to install it. Importing this
 * module states the intent, so the dependency is imported statically and must
 * be installed.
 *
 * Edge Config is an ideal read path on Vercel — reads are ultra-low-latency and
 * available in middleware without a function invocation. Writes go through the
 * Vercel REST API (they need an API token and are rate-limited), which suits
 * write-rarely data like a redirect list.
 */
import { createClient } from '@vercel/edge-config'

import type { RedirectsCache } from '../core/shared.js'

import { isCachedRedirect } from '../core/shared.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type EdgeConfigCacheOptions = {
  /**
   * Edge Config connection string used for reads.
   * @default process.env.EDGE_CONFIG
   */
  connectionString?: string
  /** Edge Config store id (`ecfg_…`), used in the write URL. */
  edgeConfigId: string
  /**
   * Item key the redirect list is stored under.
   * @default 'payload-redirects'
   */
  itemKey?: string
  /** Vercel team id — required when the store belongs to a team. */
  teamId?: string
  /** Vercel API token with write access to the Edge Config store. */
  token: string
}

/**
 * Vercel Edge Config cache. Reads use the memoized `@vercel/edge-config`
 * client; writes PATCH the Vercel REST API and throw on failure so a redirect
 * save fails loudly (matching the plugin's other cache-write hooks). This
 * adapter is environment-dumb: it always reads/writes Edge Config. To avoid
 * burning API writes on every local save, compose it with `envCache` from
 * `@whatworks/payload-redirects/cache`:
 * `envCache({ development: fileCache(), production: edgeConfigCache({ … }) })`.
 */
export const edgeConfigCache = (options: EdgeConfigCacheOptions): RedirectsCache => {
  const {
    connectionString = process.env.EDGE_CONFIG,
    edgeConfigId,
    itemKey = 'payload-redirects',
    teamId,
    token,
  } = options

  let client: ReturnType<typeof createClient> | undefined
  const getClient = () => {
    client ??= createClient(connectionString)
    return client
  }

  return {
    get: async () => {
      const value = await getClient().get(itemKey)
      if (!Array.isArray(value)) {
        return null
      }
      return value.filter(isCachedRedirect)
    },
    set: async (redirects) => {
      const url = new URL(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`)
      if (teamId) {
        url.searchParams.set('teamId', teamId)
      }

      const response = await fetch(url, {
        body: JSON.stringify({
          items: [{ key: itemKey, operation: 'upsert', value: redirects }],
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `[payload-redirects] Edge Config write failed with ${response.status}: ${text}`,
        )
      }
    },
  }
}

import type { RedirectsCache } from '@whatworks/payload-redirects'

import { fileCache } from '@whatworks/payload-redirects/cache'
import { vercelRuntimeCache } from '@whatworks/payload-redirects/vercel'

/**
 * The one cache instance shared by the plugin (payload.config.ts) and the
 * middleware (proxy.ts) — the whole point is that both sides read/write the
 * same store. `vercelRuntimeCache` delegates to the file cache while
 * NODE_ENV === 'development', which is what bridges the separate module
 * graphs `next dev` runs the proxy and the server in.
 *
 * The path is relative to the working directory, so run `pnpm dev` from the
 * package root (`.dbs/` is gitignored). Override with REDIRECTS_DEV_CACHE (e.g.
 * a throwaway path for e2e) so a test run never clobbers local dev state.
 */
export const cache: RedirectsCache = vercelRuntimeCache({
  development: fileCache({
    path: process.env.REDIRECTS_DEV_CACHE ?? 'dev/.dbs/redirects-cache.json',
  }),
})

import { envCache, fileCache } from '@whatworks/payload-redirects/cache'
import { defineRedirectsConfig } from '@whatworks/payload-redirects/middleware'
import { vercelInvalidate, vercelRuntimeCache } from '@whatworks/payload-redirects/vercel'

/**
 * The one config shared by the plugin (payload.config.ts) and the middleware
 * (proxy.ts). Spread it into `redirectsPlugin({ ...redirectsConfig, collections })`
 * and pass it straight to `createRedirectsMiddleware(redirectsConfig)` — both
 * sides then read/write the same cache and can never drift.
 *
 * `defineRedirectsConfig` is imported from the edge-safe `/middleware` entry so
 * this module (imported by the proxy) stays free of `payload`/Node imports.
 * `envCache` picks the file cache in development — which bridges the separate
 * module graphs `next dev` runs the proxy and the server in — and the Vercel
 * Runtime Cache in production. Both are only ever accelerators: the plugin's
 * CDN-cacheable list endpoint is the origin either reads through to on a miss,
 * and `list.invalidate` purges both layers when redirects change.
 *
 * The file-cache path is relative to the working directory, so run `pnpm dev`
 * from the package root (`.dbs/` is gitignored). Override with
 * REDIRECTS_DEV_CACHE (e.g. a throwaway path for e2e) so a test run never
 * clobbers local dev state.
 */
export const redirectsConfig = defineRedirectsConfig({
  cache: envCache({
    development: fileCache({
      path: process.env.REDIRECTS_DEV_CACHE ?? 'dev/.dbs/redirects-cache.json',
    }),
    production: vercelRuntimeCache(),
  }),
  // With a purge wired up, expiry no longer has to carry freshness. Gated on
  // the same signal `envCache` uses, so local dev never calls a Vercel API that
  // isn't there (it would only log, but on every save).
  ...(process.env.NODE_ENV === 'development'
    ? {}
    : { list: { invalidate: vercelInvalidate, maxAge: 60 * 60 * 24 * 365 } }),
})

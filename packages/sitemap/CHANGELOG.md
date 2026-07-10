# @whatworks/payload-sitemap

## 0.2.1

### Patch Changes

- 697cf50: Resolve the sitemap origin from the incoming request's public host (`x-forwarded-host`/`Host`, then the request URL) before any environment fallback, so zero-config deployments mirror whichever domain each sitemap was requested on. An explicit `siteUrl` option still pins a canonical domain; `SITE_URL`, `NEXT_PUBLIC_SERVER_URL`, and Vercel's project URL now only apply when no request is available. The robots metadata route reads `next/headers` when the origin isn't pinned, and an empty `x-forwarded-host` header no longer shadows `Host`.

## 0.2.0

### Minor Changes

- 28e6965: Rename the `robots.isProduction` option to `robots.allowIndexing`. It names the effect directly: when `false`, robots.txt disallows everything so non-production environments stay out of search indexes. The default is unchanged (`VERCEL_ENV`/`NODE_ENV === 'production'`).

  **Breaking:** rename `isProduction` to `allowIndexing` in your `robots` config and in any `createRobots` / `generateRobotsTxt` overrides.

## 0.1.0

### Minor Changes

- 527d4cb: Initial release: chunked, lazily cached XML sitemaps for Payload with hook-driven invalidation.

  - One sitemap file per collection behind a `<sitemapindex>`, chunked at a configurable size
  - Lazy regeneration with pluggable caching: Next.js Data Cache tags on Vercel (default), in-memory for standalone servers, or a custom adapter
  - Collection hooks invalidate in-process after the response commits — no self-HTTP round trip, no unauthenticated regenerate endpoint
  - Per-collection typed `path()` returning paths joined to a `siteUrl` resolved from config/env, falling back to the incoming request (env wins, so deploy aliases never leak into canonical URLs; entries are cached host-independently)
  - Injected admin fields can nest under an existing group field or named tab via `adminFields.group`
  - Lean queries: `select` + `depth: 0` + paginated batches; `_status` filter only on draft-enabled collections
  - Optional REST endpoints (disabled by default) with per-endpoint access control, plus a JSON entries endpoint for SSG frontends
  - robots.txt helpers: `createRobots` for `app/robots.ts`, `generateRobotsTxt` for any stack, with production gating and full `transform` override
  - Zero runtime dependencies; XML built in-package

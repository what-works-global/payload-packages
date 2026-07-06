# @whatworks/payload-sitemap

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

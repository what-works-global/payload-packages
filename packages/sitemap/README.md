# @whatworks/payload-sitemap

Chunked, lazily cached XML sitemaps for [Payload](https://payloadcms.com) with hook-driven invalidation and robots.txt helpers.

Next.js + Vercel work with near-zero config; every layer — delivery, caching, invalidation, robots output — is overridable for other stacks (decoupled frontends, self-hosted servers, SSG builds).

## How it works

- **Lazy generation.** Nothing regenerates on save. Collection hooks only mark a group's cache dirty (deduped per request, run after the response so the transaction has committed). The next sitemap request regenerates that group from the database — slug changes, breadcrumb cascades (e.g. `plugin-nested-docs` re-saving children), publishes, unpublishes, and deletes all come out correct without any change detection.
- **One sitemap file per collection, chunked.** `/sitemap.xml` is a `<sitemapindex>` referencing `pages-1.xml`, `posts-1.xml`, … split at `chunkSize` (default 25,000; protocol limit 50,000).
- **Lean queries.** Docs are fetched in pages of 1,000 with `select`, `depth: 0`, and a `_status` filter applied only when the collection actually has drafts enabled.
- **Caching:** with `'auto'` (default), entries are cached in the Next.js Data Cache with tags (`revalidateTag` invalidation — works across serverless instances on Vercel) and fall back to an in-memory cache outside Next. Responses also carry `Cache-Control: s-maxage` so a CDN absorbs crawler traffic.

## Quick start (Payload inside Next.js)

```ts
// payload.config.ts
import { sitemapPlugin } from '@whatworks/payload-sitemap'

export default buildConfig({
  plugins: [
    sitemapPlugin({
      collections: {
        pages: {
          path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`),
          select: { slug: true },
        },
      },
    }),
  ],
})
```

```ts
// app/sitemap.xml/route.ts
import config from '@payload-config'
import { createSitemapIndexRoute } from '@whatworks/payload-sitemap/next'

export const dynamic = 'force-dynamic'
export const { GET } = createSitemapIndexRoute({ config })
```

```ts
// app/sitemaps/[sitemap]/route.ts
import config from '@payload-config'
import { createSitemapChunkRoute } from '@whatworks/payload-sitemap/next'

export const dynamic = 'force-dynamic'
export const { GET } = createSitemapChunkRoute({ config })
```

```ts
// app/robots.ts
import config from '@payload-config'
import { createRobots } from '@whatworks/payload-sitemap/next'

export default createRobots({ config })
```

This is the entire setup — no env vars required. `robots.txt` disallows everything outside production (`VERCEL_ENV`/`NODE_ENV`), and disallows the admin + API routes in production.

### How `siteUrl` is resolved

Every URL in the sitemap is joined onto the first available of:

1. the `siteUrl` plugin option — a string, or a function `({ request }) => string` with full control
2. **the incoming request** — `x-forwarded-proto`/`x-forwarded-host`, then `Host`, then the request URL's origin
3. `SITE_URL` → `NEXT_PUBLIC_SERVER_URL`
4. `https://$VERCEL_PROJECT_PRODUCTION_URL`

The request deliberately outranks the env vars: with zero configuration, a deployment
answering on several hosts (`example.com`, `staging.example.com`, `*.vercel.app`) emits
each sitemap on the host it was requested from. Set the `siteUrl` option when multiple
public hosts must emit one canonical domain. The env vars cover request-less contexts
(build steps, background jobs); Vercel's project URL comes last because it is derived —
and frozen at build time — rather than configured. The `app/robots.ts` helper reads
`next/headers` when the origin isn't pinned by an option string, which makes that route
dynamic.

Host headers are client-controlled, so request-derived origins are never written to the
shared cache — entries are cached as site-relative paths and joined onto the resolved
origin per request. A forged `Host` can only distort the forger's own response, provided
your proxy/CDN **sets** `x-forwarded-host` itself (Vercel does) instead of passing a
client-supplied value through to a shared HTTP cache.

## Plugin options

```ts
sitemapPlugin({
  // Required. Per-collection config, typed against your generated types.
  collections: {
    pages: {
      // Return a path (joined to siteUrl) or an absolute URL (used verbatim).
      // Return null/undefined to omit the doc.
      path: ({ doc }) => `/${doc.slug}`,
      // Fields your path()/lastMod() need. id/updatedAt are always included.
      select: { slug: true, breadcrumbs: true },
      lastMod: 'publishedAt', // field name, (doc) => Date, or false. Default 'updatedAt'
      where: {}, // extra query constraints
      chunkSize: 10_000, // per-collection override
      changeFreq: 'weekly', // opt-in; Google ignores it
      priority: 0.5, // opt-in; Google ignores it
      // Override the default invalidation heuristic (invalidate on any change
      // except a draft save with no published transition):
      shouldInvalidate: ({ doc, previousDoc, operation }) => true,
    },
  },

  // String, or a function with full control (multi-tenant, per-request logic).
  // Default: incoming request → env chain (see “How siteUrl is resolved”).
  siteUrl: ({ request }) => `https://${request.headers.get('host')}`,
  trailingSlash: false,
  chunkSize: 25_000,

  // Extra routes: static array, or an async function (e.g. read a global).
  routes: async ({ payload }) => [{ path: '/search' }],

  // Injected admin fields. Default: an `excludeFromSitemap` sidebar checkbox.
  // `group` nests them inside the group field (or named tab) with that name —
  // e.g. an existing `metadata` group. Dot notation reaches nested containers
  // (`'seo.metadata'`); missing segments are created as groups on collections
  // that lack them. The exclude flag then lives at `metadata.excludeFromSitemap`.
  adminFields: { exclude: true, group: 'metadata' },

  // 'auto' (default) | 'memory' | 'none' | custom { wrap, invalidate } adapter.
  cache: 'auto',

  // REST endpoints under the API route. DISABLED by default — the Next route
  // handlers above are the primary delivery.
  endpoints: {
    path: '/sitemap', // → /api/sitemap/index.xml, /api/sitemap/pages-1.xml
    access: ({ req }) => true, // XML access; default public once enabled
    json: true, // /api/sitemap/entries.json; default access: req.user
    cacheControl: 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    origin: 'https://cms.example.com', // index chunk-URL origin; default: request origin
  },

  // Defaults for robots output (createRobots / generateRobotsTxt).
  robots: {
    allowIndexing: undefined, // default VERCEL_ENV/NODE_ENV
    disallow: ['/drafts/'], // appended to the default rule
    rules: undefined, // replace default rules entirely
    sitemaps: undefined, // default `${siteUrl}/sitemap.xml`
    transform: (robots) => robots, // final say over the computed output
  },

  disabled: false, // keeps injected fields for schema/migration consistency
})
```

## Decoupled frontends & other stacks

Payload standalone as a headless CMS, frontend elsewhere (Astro, SvelteKit, …):

1. **Enable the REST endpoints** (`endpoints: true`). The sitemap serves from
   `https://cms.example.com/api/sitemap/index.xml`.
2. Either **proxy** `/sitemap.xml` → the CMS endpoint from your frontend, or declare it
   cross-host in the frontend's robots.txt (sanctioned by sitemaps.org):
   `Sitemap: https://cms.example.com/api/sitemap/index.xml`
3. For **build-time SSG**, fetch `/api/sitemap/entries.json` (authenticated by default)
   or call `getSitemapEntries(payload)` in a build script and render however you like.
4. `generateRobotsTxt(config, overrides?)` returns a robots.txt string for any server.

On a long-running self-hosted server, set `cache: 'memory'` — hooks invalidate it
in-process. For anything else, implement the two-method `SitemapCache` interface
(`wrap`, `invalidate`) — e.g. backed by Redis — and pass it as `cache`.

## Public API

| Export (`.`)                                                                    | Purpose                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `sitemapPlugin(config)`                                                         | The Payload plugin                                                  |
| `getSitemapEntries(payload, opts?)`                                             | All cached entries keyed by group                                   |
| `invalidateSitemap(payload, groups?)`                                           | Manual invalidation (e.g. from a global's hook that feeds `routes`) |
| `generateRobotsTxt(config, overrides?)`                                         | robots.txt string for any delivery                                  |
| `getIndexItems` / `getChunkEntries` / `buildUrlsetXml` / `buildSitemapIndexXml` | Building blocks for custom delivery                                 |
| `SITEMAP_CACHE_TAG` / `sitemapCacheTag(group)`                                  | Next cache tags, for custom `revalidateTag` calls                   |

| Export (`./next`)                                                 | Purpose                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `createSitemapIndexRoute({ config, chunksPath?, cacheControl? })` | `GET` handler for `app/sitemap.xml/route.ts`        |
| `createSitemapChunkRoute({ config, param?, cacheControl? })`      | `GET` handler for `app/sitemaps/[sitemap]/route.ts` |
| `createRobots({ config, ...robotsOverrides })`                    | Default export for `app/robots.ts`                  |

## Development

`pnpm dev` (from `packages/sitemap`) boots the sandbox in `dev/` — a Next app with the
admin at [/admin](http://localhost:3000/admin) (login form comes prefilled) and a demo
page at [/](http://localhost:3000) listing every delivery surface plus the live cached
entries. It seeds a drafts-enabled `pages` collection, a draftless `legal` collection,
a draft-only doc and an `excludeFromSitemap` doc into a throwaway SQLite database
(`dev/.dbs/`, gitignored — delete it to reseed). Publish/delete docs in the admin and
reload to watch hook-driven invalidation land.

## Notes

- **`changefreq`/`priority` are opt-in** because Google ignores both; `lastmod` is the
  only freshness signal it uses. Skipping them keeps the admin sidebar and XML lean.
- **Invalidation timing:** hooks schedule invalidation via Next's `after()` (post-response,
  post-commit; uses `waitUntil` on Vercel) with a plain macrotask fallback outside Next.
  `revalidateTag` is called with `{ expire: 0 }` for instant expiry on Next 16; Next 15
  ignores the extra argument.
- **CDN staleness trade-off:** the default `s-maxage=600` means a CDN may serve a
  sitemap up to 10 minutes stale after a publish — regeneration is cheap behind it, so
  tune `cacheControl` if you need tighter freshness.
- Drafts are never included: the `_status` filter applies exactly when the collection
  has drafts enabled, so collections without drafts also work (no `_status` query error).

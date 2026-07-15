# @whatworks/payload-redirects

Managed redirects for [Payload](https://payloadcms.com) with a cache-backed [Next.js](https://nextjs.org) middleware matcher.

Editors manage redirects in an orderable admin collection; the plugin denormalizes them into a shared cache on every change; your `proxy.ts`/`middleware.ts` answers matching requests straight from that cache — no Payload import, no database query, no function invocation on the hot path.

- **Internal or custom destinations** — point a redirect at a document (resolved to its path, kept in sync when the doc moves or is deleted) or at any URL/pathname.
- **Regex redirects with capture groups** — `^/blog/(.+)$` → `/news/$1`.
- **Scroll-to anchors** — an optional element id appended to the destination as a `#fragment`.
- **Hit tracking** — per-redirect hit counter and last-access timestamp, updated in the background.
- **Pluggable cache** — Vercel Runtime Cache, JSON file, in-memory, or your own adapter; the Vercel adapter takes a `development` cache for local work.

## Install

```sh
pnpm add @whatworks/payload-redirects
# Only if you use the Vercel Runtime Cache adapter:
pnpm add @vercel/functions
```

## Quick start

Define the cache once, in a module imported by **both** your Payload config and your middleware — the plugin writes to it, the middleware reads from it, so both sides must share one backing store:

```ts
// redirects-cache.ts
import { vercelRuntimeCache } from '@whatworks/payload-redirects/vercel'

export const cache = vercelRuntimeCache()
// In development the adapter delegates to a JSON file cache
// (.next/cache/payload-redirects.json) — configurable:
//   vercelRuntimeCache({ development: fileCache({ path: '...' }) })
```

```ts
// payload.config.ts
import { redirectsPlugin } from '@whatworks/payload-redirects'
import { cache } from './redirects-cache'

export default buildConfig({
  plugins: [
    redirectsPlugin({
      cache,
      collections: {
        // Collections editors can pick as internal destinations, and how a
        // referenced doc resolves to the path it lives at.
        pages: { path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`) },
      },
    }),
  ],
})
```

```ts
// proxy.ts (Next 16) — or middleware.ts with the nodejs runtime
import type { NextFetchEvent, NextRequest } from 'next/server'
import { createRedirectsMiddleware } from '@whatworks/payload-redirects/middleware'
import { NextResponse } from 'next/server'
import { cache } from './redirects-cache'

const redirects = createRedirectsMiddleware({ cache })

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  return (await redirects(request, event)) ?? NextResponse.next()
}
```

## How it works

The plugin adds an orderable `redirects` collection. Every create/update/delete/reorder rebuilds the full redirect list — normalized `from`, resolved destination, `scrollTo` fragment applied — and writes it to the cache in one entry. Collections configured as destinations get hooks too: when a published document's path changes (or it is deleted), the cache is rebuilt so resolved destinations never go stale. Draft saves never touch the cache.

The middleware reads the list per request, matches in admin drag order, and issues the redirect. On a cache miss it returns `undefined` immediately and refreshes the cache in the background via the plugin's `refresh-cache` endpoint (`event.waitUntil`), so a cold cache costs one pass-through request, never latency.

Matching normalizes trailing slashes and matches `path?search` first, then the bare path — so `/old` still matches `/old/?utm_source=x`. Fragments are compared away in the self-redirect guard (they are never sent to the server, so `/pricing` → `/pricing#plans` would loop and is skipped).

## Cache adapters

A cache is just:

```ts
interface RedirectsCache {
  get: () => Promise<CachedRedirect[] | null> // null = miss
  set: (redirects: CachedRedirect[]) => Promise<void>
}
```

| Adapter                        | Import                                | Use                                                                                                                                                                            |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vercelRuntimeCache(options?)` | `@whatworks/payload-redirects/vercel` | Vercel deployments. Region-shared runtime cache, readable from middleware. Delegates to `options.development` (default `fileCache()`) while `NODE_ENV === 'development'`.      |
| `fileCache({ path? })`         | `@whatworks/payload-redirects/cache`  | Development and single-server self-hosting. Atomic JSON file writes; bridges the separate module graphs `next dev` runs the middleware and server in. Requires a Node runtime. |
| `memoryCache()`                | `@whatworks/payload-redirects/cache`  | Tests, or a single long-lived process serving both sides. Writes are invisible across processes — not for serverless or `next dev`.                                            |

`vercelRuntimeCache` options: `development` (`RedirectsCache | false`), `key`, `tags`, and `ttl` — the TTL defaults to a year because the runtime cache treats entries without one as never fresh; hooks re-sync on every change, so expiry is not relied on for correctness.

The Vercel adapter lives in its own entry point on purpose: bundlers resolve even dynamic `import()`s at build time, so referencing `@vercel/functions` from the shared `/cache` entry would force the optional dependency on every consumer. Anything with `get`/`set` works as an adapter — Redis, Edge Config, your own service.

## Plugin options

```ts
redirectsPlugin({
  cache, // required — see above
  collections: {
    // internal-destination collections (omit for custom URLs only)
    pages: {
      path: ({ doc, req }) => string | null | undefined,
      // Runs at cache-build time with the referenced doc populated one level
      // deep. Return null/undefined (or throw) to drop redirects pointing at
      // this doc.
    },
  },
  slug: 'redirects', // collection slug
  endpointsPath: '/payload-redirects', // REST base path (must match the middleware option)
  hits: true, // hit counter + lastAccess fields and the hit endpoint
  disabled: false, // keep the collection (schema parity) but disable everything else
  overrides: ({ collection }) => collection, // final say over the generated collection
})
```

`syncRedirectsCache(payload, req?)` is exported for priming the cache from seed scripts; `getRedirectsConfig(config)` returns the resolved plugin config from a Payload config.

## Middleware options

```ts
createRedirectsMiddleware({
  cache, // required — same backing store as the plugin
  apiBasePath: '/api', // Payload REST base path as seen by the browser
  endpointsPath: '/payload-redirects',
  trackHits: true, // report matches to the hit endpoint (disable with hits: false)
  refreshOnMiss: true, // rebuild the cache in the background on a miss
})
```

The returned function takes `(request, event?)` and resolves to a `NextResponse` redirect or `undefined`. Background work (hit tracking, refresh) runs through `event.waitUntil` when an event is passed. A broken cache backend never takes down routing — errors read as "no redirects".

## The redirects collection

- **From URL** — a pathname (`/old`, trailing slashes collapsed) or absolute URL (reduced to its path + query). Unique, validated.
- **Use Regex** — treat From as a regular expression; capture groups substitute into a custom destination URL as `$1`, `$2`, … (unmatched groups become empty strings).
- **To** — an internal document reference (when `collections` are configured) or a custom URL/pathname.
- **Scroll To Element** — optional element id appended to the destination as `#fragment` (a leading `#` is tolerated; it replaces any fragment a custom URL already carries).
- **Redirect Type** — `301` permanent or `302` temporary.
- **Hits / Last Access** — read-only sidebar fields, updated by the middleware in the background without triggering hooks or a cache rebuild.

Rows are drag-orderable; earlier rows win when several match. Redirects that cannot produce a working redirect (unresolvable reference, empty destination) are dropped from the cache rather than cached broken.

## Endpoints

Registered under the Payload API route at `endpointsPath`:

- `POST /api/payload-redirects/refresh-cache` — rebuild the cache from the database. Public by design (the middleware calls it on cold caches); it only rewrites the cache from existing data.
- `POST /api/payload-redirects/hit/:id` — increment a redirect's hit counter (only when `hits` is enabled). Not atomic under heavy concurrency; it is analytics, not accounting.

## Failure semantics

- Hooks on the **redirects collection** propagate cache-write failures — a redirect an editor believes is live but never reached the cache is worse than a failed save.
- Hooks on **destination collections** only log failures — a broken cache backend must not block content publishing.
- The **middleware** swallows cache read errors and passes the request through.

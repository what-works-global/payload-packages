# @whatworks/payload-redirects

## 0.3.0

### Minor Changes

- 3f95d7f: Read-through serving fixes multi-region reads, on by default — and cache invalidation moves to where it belongs.

  **No consumer changes required.** The published `RedirectsCache` interface (`get`/`set`) is untouched, `cache` is widened from required to optional, and everything else here is new surface. Upgrading is enough.

  **The bug.** Redirect serving is multi-region; redirect writing is not. Routing middleware runs in whichever region is nearest the visitor (true in the Node runtime too — the runtime setting controls the sandbox, not the placement), while the Payload function that writes the cache runs only in the project's function region. A region-scoped cache is therefore written in one place and read from many, so every other region reads an empty cache. It never self-healed: on a miss, `refreshOnMiss` POSTed `refresh-cache`, which rebuilt in the _writing_ region again — leaving the region that missed just as cold, the visitor unredirected, and a full rebuild paid for nothing. Measured on a production deployment: twelve reading regions, one writing region, a 26–42% hit rate, and roughly one wasted rebuild per read, with the same URL serving a 301 and a 404 within the same hour.

  **The fix, with nothing to configure.** The plugin now registers `GET {endpointsPath}/list` — the denormalized redirect list, built fresh from the database, under CDN-cacheable headers and a purgeable cache tag. On a cache miss the resolver fetches it, **answers the current request from it**, and seeds the local cache. A cold region serves the right redirect on its _first_ request and stops missing. Correctness lives at the origin and a cache is only ever an accelerator — which also closes the same cold-start hole in `fileCache` and `memoryCache`.

  Concurrent misses on a cold instance collapse into a single fetch, and a failed list fetch falls back to the old behaviour rather than breaking routing.

  **Three layers, one config block.** `list` lives on the shared config, so a single object drives both halves — the plugin uses `maxAge`/`staleWhileRevalidate`/`tags` for the response headers and `disabled` to decide whether to register the endpoint; the serving side uses `path`/`disabled` to decide what to read through to. `cacheMemoMs` joins it there (ignored server-side, like `api`), so all three cache layers are configured in one place:

  ```ts
  export const redirectsConfig = defineRedirectsConfig({
    cacheMemoMs: 5000, // in-process memo — the one layer no purge can reach
    cache: vercelRuntimeCache(), // optional regional store, no HTTP hop on a hit
    list: { invalidate: vercelInvalidate, maxAge: 60 * 60 * 24 * 365 },
  })
  ```

  **`cache` is now optional.** Omit it to run on the list route and the memo alone — correct, just a fetch per memo expiry where a store would have had none. A store was never the source of truth. A cache adapter that _throws_ is also now treated as a miss rather than as "no redirects", so a misconfigured accelerator (bad token, missing binding) degrades to the origin instead of silently disabling every redirect.

  **`list.disabled` gates endpoint registration, not the read-through.** With a `path` it means "I serve the list myself" — the plugin stops registering its endpoint and the serving side reads through to your route. Without one it means "there is no list route", which restores the legacy miss path.

  **New `list.invalidate` hook, and `set` never purges.** Two callers reach `cache.set`: the plugin when redirects change, and the serving side when it seeds a store after a read-through. An adapter cannot tell them apart, so a purge behind `set` fires on every read and invalidates the copy just fetched. Invalidation therefore lives on `list.invalidate`, called once per cache write and never by the read-through — with `list.tags` as the single source of truth for the tag the response carries _and_ the tag that gets purged, so the two can't drift. A failing purge is logged and swallowed; it must not fail the write that triggered it.

  **New `vercelInvalidate`** (`/vercel`) is the whole invalidation story on Vercel in one function. A tag purge there clears the CDN, Runtime, and Data caches together, in every region, propagating globally in ~300ms — so one call invalidates both cached layers at once: the CDN copies of the list route and every region's `vercelRuntimeCache` entry. It marks entries stale rather than deleting them, so the next request is answered instantly while revalidation happens behind it.

  **`vercelRuntimeCache` is the recommended store on Vercel again.** It is per-region and ephemeral (LRU eviction against a project-wide storage limit whatever TTL you ask for, and no `stale-while-revalidate` equivalent — an expired entry is a hard miss), but behind the read-through none of that costs a redirect: a cold region is correct on its first request and seeds itself. Keep its `tags` equal to `list.tags`; both default to `payload-redirects`.

  **The default list TTL is deliberately short.** `max-age=60, stale-while-revalidate=86400`, so a shared cache answers instantly from an expired copy and refreshes behind the request. A long TTL is only correct if something purges the tag, and purging is platform-specific — defaulting to a year would mean that anywhere without `list.invalidate` wired up, an edit would never propagate. Set `invalidate` and raise `maxAge` to a year.

  Note `cacheMemoMs` is the real freshness floor on every platform: no purge can reach into a running instance's memory. Keep it at the few-second default when `cache` is set; raise it when it is not.

  **The list endpoint is public**, and deliberately not secret-gated even when `secret` is set: a CDN cache key excludes request headers, so a gated-but-cached response would be handed to unauthenticated callers anyway. The `from`/`to` pairs are discoverable by probing the site regardless; use `list: { disabled: true }` and a globally readable store if that is unacceptable for your site.

  **`syncRedirectsCache` takes an options argument**, `{ invalidate?: boolean }`. The plugin's `syncOnInit` prime now passes `invalidate: false`: booting changed nothing, and on serverless that path runs on every cold start, so purging there would burn a global cache purge per instance rather than per edit. Pass it yourself when priming from a seed script. A deploy that changes how destinations resolve should POST `refresh-cache`, which does invalidate.

  **Serving the list yourself** needs no dedicated export: `buildRedirectsCacheEntries`, `getRedirectsConfig`, and the new `listResponseHeaders` are all on the package root, so a custom list route is a handful of lines on any framework that can return a `Response`. Point `list.path` at it and set `list.disabled` to stop the plugin registering its own.

## 0.2.0

### Minor Changes

- b20e22c: Admin editing and list-view improvements for the redirects collection, plus richer destination options.

  **Resolved destination column.** The list view shows a **To** column (`RedirectDestinationCell`, from the `@whatworks/payload-redirects/rsc` export) in place of the raw `to.type` / `to.url` field: internal references render as their resolved document path (linked to the doc in the admin), custom URLs link externally, and a regex destination that references capture groups (`$1`, `$2`, …) is shown as plain text since it's incomplete until match time.

  **Test a redirect in place.** A **Test Redirect** button on the edit-form sidebar and a **Test Redirect** column in the list view (both from the new `@whatworks/payload-redirects/client` export) open a redirect's `From` URL in a new tab. Root-relative paths open against the admin's own origin; the action is disabled when `From` isn't a concrete URL — a regex pattern, or a `contains` / `endsWith` fragment that isn't a path.

  **Destination query parameters.** A new `queryParams` array field (rows of `name` / `value`) on the `to` group is applied when the cache is built — names and values are URL-encoded automatically, a row wins over a param already on the destination with the same name, and any fragment (from **Scroll To Element** or a custom URL) is preserved after the query (`/sale` + `utm_source=nl` + `#plans` → `/sale?utm_source=nl#plans`). Revealed by **Show advanced settings** (and shown whenever a redirect already carries params). New helpers `applyQueryParams` and `normalizeQueryParams` (shared/edge-safe entry) and `validateQueryParamKey` are exported for building your own fields.

  **Optional admin peer deps.** `@payloadcms/ui`, `react`, and `react-dom` are declared as optional peer dependencies — only the admin `./rsc` and `./client` entries import them; the middleware / resolver bundles do not. Consumers should regenerate their admin import map (`payload generate:importmap`) so the new cells and button resolve.

  **Minimum Payload raised to 3.54.0** (from 3.32.0). The plugin never actually worked on the older floor: the `orderable` redirects collection relies on Payload's `_order` fractional-index handling, which mis-generated duplicate keys for a collection with `unique` / `group` fields until it was reworked, and the endpoint-secret hardening and cache-rebuild paths likewise depended on request/query behaviour that only settled in 3.54.0. This matches `@whatworks/payload-switch-env`'s floor.

## 0.1.0

### Minor Changes

- 55cb5be: Initial release: managed redirects for Payload with a cache-backed, framework-agnostic middleware matcher. An orderable redirects collection (simple by default, with matching/query/metadata options behind a "Show advanced settings" toggle) supports internal-document or custom-URL destinations, five match types — exact, starts with, ends with, contains, and safe-validated regex with capture-group substitution — plus per-redirect case-insensitivity, query forwarding, an enabled toggle, and editor notes. `from` values are canonicalized (trailing slashes, sorted query, percent-encoding), redirect loops are rejected at save time and exact chains flattened at build time so visitors take a single hop, and open-redirect escapes are blocked. Hit tracking uses adapter-agnostic optimistic concurrency; endpoints can be locked down with a shared `secret`; localization builds one cache per locale. A single `defineRedirectsConfig` object (cache, `endpointsPath`, `secret`, `api`) spreads into both the plugin and the serving side so they can never drift, and the plugin can rebuild the cache on boot (`syncOnInit`, default true). Ships a Next.js middleware (`onRedirect`, `debug`, `cacheMemoMs`, `secret`) that is a thin wrapper over a framework-agnostic serving core (`@whatworks/payload-redirects/resolver`): `createRedirectsResolver` and `createRedirectsRequestHandler` use WHATWG APIs only (fetch/URL/Request/Response, no `payload`/`next`/Node imports) and carry the same operational behavior — memoized cache reads, matching, query forwarding, trailing-slash normalization, background cache refresh, and hit tracking (`trackHits`) — to Hono, Cloudflare Workers, Astro, SvelteKit, Express, and more; the single `api` option takes either a relative base path or an absolute URL for split-origin (separate CMS host) deployments. A pure `resolveRedirect` (with an `onSkip` diagnostic) sits underneath for full manual control. Also: pluggable caches (Vercel Runtime Cache, Vercel Edge Config, Redis/Upstash, Cloudflare KV, JSON file, in-memory) plus an `envCache` composer for an explicit per-environment dev fallback, destination-collection re-sync on move/delete, `select` narrowing, and a `migrateFromOfficialRedirects` helper for `@payloadcms/plugin-redirects`.

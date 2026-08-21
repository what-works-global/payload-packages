/**
 * Config shared by BOTH halves of the plugin — the Payload plugin (cache
 * writer) and the Next.js middleware / framework-agnostic resolver (cache
 * reader). Defining it once, with {@link defineRedirectsConfig}, lets a single
 * object spread into both sides so they can never drift on `cache`,
 * `endpointsPath`, `list`, or `secret`.
 *
 * Nothing here may import `payload`, `next*`, or Node built-ins — this module is
 * pulled into the edge-safe serving entries, and the edge-safety test enforces
 * it. Only a `type` import from `./shared.js` (elided at runtime) is allowed.
 */
import type { RedirectsCache } from './shared.js'

/**
 * How the list route is served and invalidated. Read by both halves: the plugin
 * uses `maxAge`/`staleWhileRevalidate`/`tags` for the response headers and
 * `disabled` to decide whether to register the endpoint at all; the serving side
 * uses `path`/`disabled` to decide what to read through to on a cache miss.
 */
export type RedirectsListConfig = {
  /**
   * Stop the plugin registering its own list endpoint. What that means for the
   * serving side depends on whether you also set `path`:
   *
   * - **with `path`** — "I serve the list myself". The endpoint is not
   *   registered, and the serving side reads through to your route instead.
   * - **without `path`** — "there is no list route". Nothing serves the list, so
   *   the serving side has no origin and falls back to the legacy miss path,
   *   where a miss returns no redirect and only fires a background
   *   `refresh-cache` POST. Only sound when the reader and the writer genuinely
   *   share one region, or when `cache` is a globally readable store.
   *
   * @default false
   */
  disabled?: boolean
  /**
   * Purge the list from every shared cache in front of it. Called once per cache
   * write — that is, whenever redirects actually change — with `tags`. Never
   * called by the serving side's read-through, so it is safe for this to be a
   * real CDN purge.
   *
   * This is the hook that lets `maxAge` be long: with a purge wired up, an edit
   * propagates immediately instead of waiting for the TTL. On Vercel, pass
   * `vercelInvalidate` from `@whatworks/payload-redirects/vercel` — a tag purge
   * there clears the CDN, Runtime, and Data caches together, in every region, so
   * one call covers both the list route AND a regional `vercelRuntimeCache`.
   * Elsewhere, call your own CDN's purge API.
   *
   * Errors are logged and swallowed — a failed purge must not fail the write
   * that triggered it. Without it, `maxAge` is the only thing bounding staleness.
   */
  invalidate?: (tags: string[]) => Promise<void>
  /**
   * How long shared caches may serve the list without revalidating, in seconds.
   * Served with `stale-while-revalidate`, so an expired copy is still answered
   * instantly while it refreshes behind the request.
   *
   * Short by default, because purging is platform-specific and nothing here can
   * assume a purge exists — with none wired up, a long TTL would mean an edit
   * never propagates. **Once `invalidate` is set, raise this to a year**: the
   * purge then carries freshness and the origin only sees a request per region
   * per edit.
   * @default 60
   */
  maxAge?: number
  /**
   * Where the serving side reads the list from. Two forms, matching `api`:
   *
   * - A **relative path** (e.g. `'/api/payload-redirects/list'`) — resolved
   *   against each request's own origin, with the Next `basePath` prefixed
   *   automatically.
   * - An **absolute URL** — used verbatim, for split-origin setups where the CMS
   *   lives on a different origin than the app serving redirects.
   *
   * Defaults to the plugin's own list endpoint, derived from `api` and
   * `endpointsPath` (`/api/payload-redirects/list`) — so read-through works with
   * no configuration. Set it to point at your own route instead, built from
   * `buildRedirectsCacheEntries` + `listResponseHeaders` (both exported from the
   * package root) on whatever framework serves it.
   */
  path?: string
  /**
   * How long a stale list may be served while it revalidates behind the request,
   * in seconds.
   * @default one day
   */
  staleWhileRevalidate?: number
  /**
   * Cache tags set on the response (`Vercel-Cache-Tag`) and handed to
   * `invalidate`. The single source of truth for both, so the thing that tags
   * and the thing that purges can never drift apart.
   * @default ['payload-redirects']
   */
  tags?: string[]
}

/**
 * The options shared by `redirectsPlugin`, `createRedirectsMiddleware`, and
 * `createRedirectsResolver`. Define it once and spread it into both sides:
 *
 * ```ts
 * const redirectsConfig = defineRedirectsConfig({ cache })
 * redirectsPlugin({ ...redirectsConfig, collections: { … } }) // payload.config.ts
 * createRedirectsMiddleware(redirectsConfig)                   // proxy.ts
 * ```
 */
export type SharedRedirectsConfig = {
  /**
   * Base of the Payload REST API the middleware/resolver call for background
   * cache refresh and hit tracking. Two forms:
   *
   * - A **relative path** (default `'/api'`) — resolved against each request's
   *   own origin. In a Next.js app with a `basePath`, the middleware prefixes it
   *   automatically, so keep this as `'/api'`, not `'/<basePath>/api'`.
   * - An **absolute URL** (`'https://cms.example.com/api'`) — used verbatim, for
   *   split-origin setups where the CMS lives on a different origin than the app
   *   serving redirects. The Next `basePath` is never applied to an absolute base.
   *
   * Ignored by the plugin (server) side — it only concerns the serving side.
   * @default '/api'
   */
  api?: string
  /**
   * A store for the denormalized redirect list, in front of the list route. The
   * plugin writes it on every change; the serving side reads it per request and
   * seeds it after a read-through. Adapters live in
   * `@whatworks/payload-redirects/cache`.
   *
   * In a single deployment, give both sides the same adapter — define it once in
   * a shared module — so the plugin's writes warm the store directly. That is no
   * longer a requirement though: the read-through seeds whatever store the
   * serving side has, which is what makes a store the writer cannot reach (a
   * Worker's KV binding, a per-instance `memoryCache()`) a sensible choice.
   *
   * **Optional.** Omit it to run on the list route alone: the serving side then
   * fetches the list on every memo expiry, which is correct (and on Vercel,
   * usually a regional CDN hit) — just a network hop where a store would have
   * had none. A store is never the source of truth; `list` is.
   */
  cache?: RedirectsCache
  /**
   * In-memory micro-memo (per serving instance) of the last resolved redirect
   * list, whether it came from `cache` or from a read-through. The window is in
   * milliseconds; `0` disables it. A miss is never memoized, so a newly written
   * list is picked up on the very next request.
   *
   * This is the only layer no purge can reach — nothing can invalidate a running
   * instance's memory — so it is the floor on how quickly an edit is seen. Keep
   * it short (seconds) when `cache` is set; raise it when it is not, to trade
   * propagation delay for fewer fetches.
   *
   * Ignored by the plugin (server) side — it only concerns the serving side.
   * @default 5000 when `NODE_ENV === 'production'`, otherwise 0
   */
  cacheMemoMs?: number
  /**
   * Base path the plugin's REST endpoints are mounted under, within the Payload
   * API route. The plugin and the middleware/resolver must agree on this value.
   * @default '/payload-redirects' → `/api/payload-redirects/refresh-cache`
   */
  endpointsPath?: string
  /**
   * The CDN-cacheable list route both halves treat as the source of truth: the
   * plugin serves it, the serving side reads through to it on a cache miss.
   *
   * This is what makes a multi-region read path correct. Serving code runs in
   * whichever region is nearest the visitor, while the plugin only ever writes
   * from the single region Payload runs in, so a region-scoped `cache` is empty
   * almost everywhere. A read-through has a real origin to fall back to, so a
   * cold region serves the right redirect on the very first request and seeds
   * itself for the next one.
   *
   * On by default, with no configuration required.
   */
  list?: RedirectsListConfig
  /**
   * Shared secret that locks down the `refresh-cache` and `hit/:id` endpoints.
   * On the plugin side, requests must then carry the `x-payload-redirects-secret`
   * header equal to this value (or an authenticated `req.user`); on the serving
   * side, it is sent as that header on background refresh/hit requests. Leave
   * unset for zero-config open endpoints — the plugin then logs a production
   * warning that the endpoints are publicly reachable.
   *
   * Note this does NOT gate the list route: a CDN cache key excludes request
   * headers, so a gated-but-cached response would be handed to unauthenticated
   * callers anyway. See the list endpoint's docblock.
   */
  secret?: string
}

/**
 * Identity helper for authoring a {@link SharedRedirectsConfig} with inference
 * and editor autocomplete. Returns its argument unchanged; the only value it
 * adds is the type. Spread the result into both `redirectsPlugin` and
 * `createRedirectsMiddleware`/`createRedirectsResolver`.
 */
export const defineRedirectsConfig = <T extends SharedRedirectsConfig>(config: T): T => config

/**
 * True when an `api` base is an absolute `http(s)` URL (a split-origin CMS
 * base), false when it is a relative path resolved against the request origin.
 */
export const isAbsoluteApiBase = (api: string): boolean => {
  try {
    const { protocol } = new URL(api)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

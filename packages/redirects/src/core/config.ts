/**
 * Config shared by BOTH halves of the plugin — the Payload plugin (cache
 * writer) and the Next.js middleware / framework-agnostic resolver (cache
 * reader). Defining it once, with {@link defineRedirectsConfig}, lets a single
 * object spread into both sides so they can never drift on `cache`,
 * `endpointsPath`, or `secret`.
 *
 * Nothing here may import `payload`, `next*`, or Node built-ins — this module is
 * pulled into the edge-safe serving entries, and the edge-safety test enforces
 * it. Only a `type` import from `./shared.js` (elided at runtime) is allowed.
 */
import type { RedirectsCache } from './shared.js'

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
   * The redirect cache. The plugin writes the denormalized redirect list to it
   * on every change; the middleware/resolver read it per request. Both sides
   * MUST be given the same adapter (same backing store) — define it once in a
   * shared module. Adapters live in `@whatworks/payload-redirects/cache`.
   */
  cache: RedirectsCache
  /**
   * Base path the plugin's REST endpoints are mounted under, within the Payload
   * API route. The plugin and the middleware/resolver must agree on this value.
   * @default '/payload-redirects' → `/api/payload-redirects/refresh-cache`
   */
  endpointsPath?: string
  /**
   * Shared secret that locks down the `refresh-cache` and `hit/:id` endpoints.
   * On the plugin side, requests must then carry the `x-payload-redirects-secret`
   * header equal to this value (or an authenticated `req.user`); on the serving
   * side, it is sent as that header on background refresh/hit requests. Leave
   * unset for zero-config open endpoints — the plugin then logs a production
   * warning that the endpoints are publicly reachable.
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

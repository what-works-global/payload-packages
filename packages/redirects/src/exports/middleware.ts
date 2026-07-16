/**
 * The Next.js adapter for the framework-agnostic redirect resolver, for
 * `proxy.ts` (Next 16) or `middleware.ts`. This module never imports `payload` —
 * it delegates all operational logic (memoized cache reads, matching, query
 * forwarding, background refresh / hit tracking) to `createRedirectsResolver`
 * and only adds the Next-specific concerns: `basePath` handling and
 * `NextResponse.redirect` + `event.waitUntil`.
 */
import type { NextFetchEvent, NextRequest } from 'next/server'

import { NextResponse } from 'next/server'

import type { CachedRedirect, RedirectsCache } from '../core/shared.js'
import type { RedirectsResolver } from './resolver.js'

import { createRedirectsResolver } from './resolver.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type RedirectsMiddlewareOptions = {
  /**
   * Base path the Payload REST API is served under, RELATIVE to any Next.js
   * `basePath`. When the app has a `basePath`, it is detected from the request
   * and prepended automatically — set this to just `/api` (the default), not
   * `/<basePath>/api`. Ignored when `endpointsBaseUrl` is set.
   * @default '/api'
   */
  apiBasePath?: string
  /**
   * The same cache adapter (same backing store) the plugin was configured
   * with — define it once in a shared module and import it on both sides.
   */
  cache: RedirectsCache
  /**
   * In-memory micro-memo (per middleware instance) of the last successful cache
   * read, so bursts of requests don't each hit the backing store. The window is
   * in milliseconds; `0` disables it. A miss (null) is never memoized, so a
   * background refresh is picked up on the very next request.
   * @default 5000 when `NODE_ENV === 'production'`, otherwise 0
   */
  cacheMemoMs?: number
  /**
   * Emit `console.debug('[payload-redirects] …')` diagnostics (cache misses and
   * matches). Never logs request bodies; safe to leave on in staging.
   * @default false
   */
  debug?: boolean
  /**
   * Absolute base URL of the Payload API for split-origin deployments — where
   * the CMS lives on a different origin than this Next app (e.g.
   * `'https://cms.example.com/api'`). When set, background refresh and
   * hit-tracking requests target it verbatim, ignoring the request origin,
   * `apiBasePath`, and the Next `basePath`. Leave unset for same-origin apps.
   */
  endpointsBaseUrl?: string
  /**
   * Must match the plugin's `endpointsPath` option.
   * @default '/payload-redirects'
   */
  endpointsPath?: string
  /**
   * Called for every issued redirect via `event.waitUntil` when available, else
   * fire-and-forget. Errors are swallowed — a failing hook never breaks routing.
   */
  onRedirect?: (args: {
    destination: string
    redirect: CachedRedirect
    request: NextRequest
  }) => Promise<void> | void
  /**
   * On a cache miss, POST the plugin's refresh endpoint in the background so
   * the next request is answered from a warm cache.
   * @default true
   */
  refreshOnMiss?: boolean
  /**
   * Shared secret sent as the `x-payload-redirects-secret` header on the
   * background refresh and hit-tracking requests. Set it to match the plugin's
   * `secret` option when the endpoints are locked down.
   */
  secret?: string
  /**
   * Report matched redirects to the hit endpoint in the background. Disable
   * when the plugin runs with `hits: false`.
   * @default true
   */
  trackHits?: boolean
  /**
   * Match your Next.js `trailingSlash: true` config. When enabled, relative
   * destinations get a trailing slash on the path part (before query/fragment),
   * so we redirect straight to `/about/` instead of `/about` — which Next would
   * otherwise 308 to `/about/`, a wasteful double hop. Skipped when the path is
   * `/`, already ends with `/`, or its last segment looks like a file
   * (`/logo.png`), mirroring Next's own exemption. Absolute/external
   * destinations are never touched.
   *
   * Not auto-detected: `NextRequest` exposes no reliable view of the app's
   * `trailingSlash` config, so set this explicitly when your app uses it.
   * @default false
   */
  trailingSlash?: boolean
}

export type RedirectsMiddleware = (
  request: NextRequest,
  /** Enables background work (hit tracking, cache refresh) via `waitUntil`. */
  event?: NextFetchEvent,
) => Promise<NextResponse | undefined>

/**
 * Builds the middleware matcher. Returns a redirect response when a cached
 * redirect matches the request, `undefined` otherwise — compose it into your
 * middleware chain:
 *
 * ```ts
 * // proxy.ts (Next 16) or middleware.ts
 * import { createRedirectsMiddleware } from '@whatworks/payload-redirects/middleware'
 * import { cache } from './redirects-cache'
 *
 * const redirects = createRedirectsMiddleware({ cache })
 *
 * export default async function proxy(request: NextRequest, event: NextFetchEvent) {
 *   return (await redirects(request, event)) ?? NextResponse.next()
 * }
 * ```
 */
export const createRedirectsMiddleware = (
  options: RedirectsMiddlewareOptions,
): RedirectsMiddleware => {
  const {
    apiBasePath = '/api',
    cache,
    cacheMemoMs,
    debug,
    endpointsBaseUrl,
    endpointsPath,
    onRedirect,
    refreshOnMiss,
    secret,
    trackHits,
    trailingSlash,
  } = options

  // The resolver is built lazily on the first request so it can fold the Next
  // `basePath` into the endpoint URLs (the Payload API also lives under it).
  // `basePath` is an app-level constant, so this single instance — and its cache
  // memo — is correct for every subsequent request.
  let resolver: RedirectsResolver | undefined

  return async (request, event) => {
    const { nextUrl } = request

    resolver ??= createRedirectsResolver({
      // `basePath` prefixes the Payload API too; skip it when a split-origin
      // `endpointsBaseUrl` already points at the absolute API.
      apiBasePath: endpointsBaseUrl ? apiBasePath : `${nextUrl.basePath}${apiBasePath}`,
      cache,
      cacheMemoMs,
      debug,
      endpointsBaseUrl,
      endpointsPath,
      refreshOnMiss,
      secret,
      trackHits,
      trailingSlash,
      // `onRedirect` is intentionally NOT forwarded — the middleware invokes its
      // own NextRequest-based hook below from the resolved result.
    })

    // Match against the basePath-STRIPPED path. `nextUrl.pathname` already has
    // any Next.js `basePath` removed, so redirect entries are authored (and
    // compared) without it. Carry the origin so background endpoint URLs resolve
    // against the request's own host.
    const resolverUrl = new URL(`${nextUrl.pathname}${nextUrl.search}`, nextUrl.origin)

    const result = await resolver(
      resolverUrl,
      event ? { waitUntil: (promise) => event.waitUntil(promise) } : undefined,
    )
    if (!result) {
      return undefined
    }

    const { destination, redirect, status } = result

    // A relative destination begins with a single `/`; everything else is an
    // absolute URL to another origin and passes through untouched.
    const isRelative = destination.startsWith('/')

    // Re-apply basePath to relative destinations (authored without it) and
    // resolve against the origin. Absolute destinations keep their own origin.
    const destinationUrl = isRelative
      ? new URL(`${nextUrl.basePath}${destination}`, nextUrl.origin)
      : new URL(destination, request.url)

    if (onRedirect) {
      const task = (async () => {
        try {
          await onRedirect({ destination, redirect, request })
        } catch {
          // A failing hook must never affect routing, on any code path.
        }
      })()
      if (event) {
        event.waitUntil(task)
      } else {
        void task.catch(() => {})
      }
    }

    return NextResponse.redirect(destinationUrl, status)
  }
}

/**
 * The request-matching side of the plugin, for Next.js `proxy.ts` (or
 * `middleware.ts`). This module never imports `payload` — it reads the
 * denormalized redirect list from the shared cache and answers from there via
 * the framework-agnostic `resolveRedirect`.
 */
import type { NextFetchEvent, NextRequest } from 'next/server'

import { NextResponse } from 'next/server'

import type { CachedRedirect, RedirectsCache } from '../core/shared.js'

import {
  appendTrailingSlash,
  DEFAULT_ENDPOINTS_PATH,
  isCachedRedirect,
  mergeForwardedQuery,
  resolveRedirect,
} from '../core/shared.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type RedirectsMiddlewareOptions = {
  /**
   * Base path the Payload REST API is served under, RELATIVE to any Next.js
   * `basePath`. When the app has a `basePath`, it is detected from the request
   * and prepended automatically — set this to just `/api` (the default), not
   * `/<basePath>/api`.
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

const toStatusCode = (type: CachedRedirect['type']) => Number(type) as 301 | 302

const SECRET_HEADER = 'x-payload-redirects-secret'

type Memo = { at: number; entries: CachedRedirect[] }

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
    cacheMemoMs = process.env.NODE_ENV === 'production' ? 5000 : 0,
    debug = false,
    endpointsPath = DEFAULT_ENDPOINTS_PATH,
    onRedirect,
    refreshOnMiss = true,
    secret,
    trackHits = true,
    trailingSlash = false,
  } = options

  const log = (message: string) => {
    if (debug) {
      // eslint-disable-next-line no-console -- opt-in diagnostics gated behind `debug`
      console.debug(`[payload-redirects] ${message}`)
    }
  }

  const endpointUrl = (request: NextRequest, path: string) =>
    // `basePath` prefixes the Payload API too — the plugin's endpoints live at
    // `/<basePath>/api/...`. Empty when the app has no basePath. Resolved
    // against the origin so the request's own path never leaks in.
    new URL(
      `${request.nextUrl.basePath}${apiBasePath}${endpointsPath}${path}`,
      request.nextUrl.origin,
    )

  const postEndpoint = async (request: NextRequest, path: string) => {
    const response = await fetch(endpointUrl(request, path), {
      cache: 'no-store',
      method: 'POST',
      ...(secret ? { headers: { [SECRET_HEADER]: secret } } : {}),
    })
    if (!response.ok) {
      throw new Error(`[payload-redirects] POST ${path} failed with ${response.status}`)
    }
  }

  const runInBackground = (event: NextFetchEvent | undefined, run: () => Promise<unknown>) => {
    const task = run()
    if (event) {
      event.waitUntil(task)
    } else {
      // Fire-and-forget: without an event there is nothing to anchor the
      // promise to, and a redirect must not wait on bookkeeping.
      void task.catch(() => {})
    }
  }

  // A short-lived, per-instance memo of the last non-null cache read. It only
  // dedupes the async `cache.get()` + validation across a burst; matching
  // (including regex compilation) is delegated to `resolveRedirect`.
  let memo: Memo | undefined

  const readEntries = async (): Promise<'error' | CachedRedirect[] | null> => {
    if (cacheMemoMs > 0 && memo && Date.now() - memo.at < cacheMemoMs) {
      return memo.entries
    }

    let entries: CachedRedirect[] | null
    try {
      const value = await cache.get()
      entries = Array.isArray(value) ? value.filter(isCachedRedirect) : null
    } catch {
      // A broken cache backend must never take down routing.
      return 'error'
    }

    if (cacheMemoMs > 0 && entries !== null) {
      memo = { at: Date.now(), entries }
    }

    return entries
  }

  return async (request, event) => {
    const entries = await readEntries()

    if (entries === 'error') {
      return undefined
    }

    if (entries === null) {
      log('cache miss')
      if (refreshOnMiss) {
        runInBackground(event, () => postEndpoint(request, '/refresh-cache'))
      }
      return undefined
    }

    if (entries.length === 0) {
      return undefined
    }

    // Match against the basePath-STRIPPED path. `nextUrl.pathname` already has
    // any Next.js `basePath` removed, so redirect entries are authored (and
    // compared) without it. Passing `nextUrl.toString()` would re-add basePath
    // and never match.
    const resolved = resolveRedirect(
      entries,
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      debug
        ? {
            onSkip: ({ destination, reason, redirect }) => {
              log(`skipped "${redirect.from}" -> "${destination}": ${reason}`)
            },
          }
        : undefined,
    )
    if (!resolved) {
      return undefined
    }

    const { redirect } = resolved
    let destination = redirect.forwardQuery
      ? mergeForwardedQuery(resolved.destination, request.nextUrl.search)
      : resolved.destination

    // A relative destination begins with a single `/` (the open-redirect guard
    // in `resolveRedirect` rejects `//`); everything else is an absolute URL to
    // another origin and passes through untouched.
    const isRelative = destination.startsWith('/')

    if (isRelative && trailingSlash) {
      destination = appendTrailingSlash(destination)
    }

    const status = toStatusCode(redirect.type)
    log(`match ${redirect.from} -> ${destination} (${status})`)

    // Re-apply basePath to relative destinations (authored without it) and
    // resolve against the origin. Absolute destinations keep their own origin.
    const destinationUrl = isRelative
      ? new URL(`${request.nextUrl.basePath}${destination}`, request.nextUrl.origin)
      : new URL(destination, request.url)

    if (trackHits) {
      runInBackground(event, () => postEndpoint(request, `/hit/${redirect.id}`))
    }

    if (onRedirect) {
      runInBackground(event, async () => {
        try {
          await onRedirect({ destination, redirect, request })
        } catch {
          // A failing hook must never affect routing, on any code path.
        }
      })
    }

    return NextResponse.redirect(destinationUrl, status)
  }
}

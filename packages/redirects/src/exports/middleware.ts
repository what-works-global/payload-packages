/**
 * The request-matching side of the plugin, for Next.js `proxy.ts` (or
 * `middleware.ts`). This module never imports `payload` — it reads the
 * denormalized redirect list from the shared cache and answers from there.
 */
import type { NextFetchEvent, NextRequest } from 'next/server'

import { NextResponse } from 'next/server'

import type { CachedRedirect, RedirectsCache } from '../core/shared.js'

import {
  DEFAULT_ENDPOINTS_PATH,
  getNormalizedRequestTargets,
  isCachedRedirect,
  matchRedirect,
} from '../core/shared.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type RedirectsMiddlewareOptions = {
  /**
   * Base path the Payload REST API is served under, as seen by the browser.
   * @default '/api'
   */
  apiBasePath?: string
  /**
   * The same cache adapter (same backing store) the plugin was configured
   * with — define it once in a shared module and import it on both sides.
   */
  cache: RedirectsCache
  /**
   * Must match the plugin's `endpointsPath` option.
   * @default '/payload-redirects'
   */
  endpointsPath?: string
  /**
   * On a cache miss, POST the plugin's refresh endpoint in the background so
   * the next request is answered from a warm cache.
   * @default true
   */
  refreshOnMiss?: boolean
  /**
   * Report matched redirects to the hit endpoint in the background. Disable
   * when the plugin runs with `hits: false`.
   * @default true
   */
  trackHits?: boolean
}

export type RedirectsMiddleware = (
  request: NextRequest,
  /** Enables background work (hit tracking, cache refresh) via `waitUntil`. */
  event?: NextFetchEvent,
) => Promise<NextResponse | undefined>

const toStatusCode = (type: CachedRedirect['type']) => Number(type) as 301 | 302

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
    endpointsPath = DEFAULT_ENDPOINTS_PATH,
    refreshOnMiss = true,
    trackHits = true,
  } = options

  const endpointUrl = (request: NextRequest, path: string) =>
    new URL(`${apiBasePath}${endpointsPath}${path}`, request.url)

  const postEndpoint = async (request: NextRequest, path: string) => {
    const response = await fetch(endpointUrl(request, path), {
      cache: 'no-store',
      method: 'POST',
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

  return async (request, event) => {
    let redirects: CachedRedirect[] | null
    try {
      const value = await cache.get()
      redirects = Array.isArray(value) ? value.filter(isCachedRedirect) : null
    } catch {
      // A broken cache backend must never take down routing.
      return undefined
    }

    if (redirects === null) {
      if (refreshOnMiss) {
        runInBackground(event, () => postEndpoint(request, '/refresh-cache'))
      }
      return undefined
    }

    if (redirects.length === 0) {
      return undefined
    }

    const targets = getNormalizedRequestTargets({
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    })

    for (const redirect of redirects) {
      const destination = matchRedirect(redirect, targets)
      if (destination === null) {
        continue
      }

      const destinationUrl = new URL(destination, request.url)

      // Self-redirect guard. Fragments are ignored on purpose: they are never
      // sent to the server, so `/pricing` → `/pricing#plans` would loop.
      if (
        destinationUrl.pathname === request.nextUrl.pathname &&
        destinationUrl.search === request.nextUrl.search
      ) {
        continue
      }

      if (trackHits) {
        runInBackground(event, () => postEndpoint(request, `/hit/${redirect.id}`))
      }

      return NextResponse.redirect(destinationUrl, toStatusCode(redirect.type))
    }

    return undefined
  }
}

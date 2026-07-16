/**
 * Framework-agnostic redirect serving. This module is the operational core the
 * Next.js middleware is a thin wrapper over — memoized cache reads, ordered
 * matching, query forwarding, trailing-slash normalization, and background
 * refresh / hit-tracking calls — all expressed with WHATWG primitives only
 * (`fetch`, `URL`, `Request`, `Response`). It never imports `payload`, `next*`,
 * or Node built-ins, so it stays importable from any edge/worker bundle.
 *
 * Two factories are exported:
 *
 * - `createRedirectsResolver` — returns a `(url, ctx?) => ResolvedRedirectResult
 *   | null` function. Adapters absolutize the returned `destination` themselves
 *   (it is relative or absolute exactly as resolved), giving full control over
 *   how the redirect response is written for their framework.
 * - `createRedirectsRequestHandler` — wraps the resolver and answers a WHATWG
 *   `Request` with a `Response` redirect (or `null` to pass through), for
 *   frameworks that speak the fetch API directly (Hono, Cloudflare Workers,
 *   SvelteKit, Astro, …).
 */
import type { CachedRedirect, RedirectsCache } from '../core/shared.js'

import {
  appendTrailingSlash,
  DEFAULT_ENDPOINTS_PATH,
  isCachedRedirect,
  mergeForwardedQuery,
  resolveRedirect,
} from '../core/shared.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

export type RedirectsResolverOptions = {
  /**
   * Base path the Payload REST API is served under, used with the request URL's
   * origin when `endpointsBaseUrl` is unset. In a Next app with a `basePath`,
   * prefix it yourself — the middleware wrapper does this automatically.
   * @default '/api'
   */
  apiBasePath?: string
  /**
   * The same cache adapter (same backing store) the plugin was configured
   * with — define it once in a shared module and import it on both sides.
   */
  cache: RedirectsCache
  /**
   * In-memory micro-memo (per resolver instance) of the last successful cache
   * read, so bursts of requests don't each hit the backing store. The window is
   * in milliseconds; `0` disables it. A miss (null) is never memoized, so a
   * background refresh is picked up on the very next request.
   * @default 5000 when `NODE_ENV === 'production'`, otherwise 0
   */
  cacheMemoMs?: number
  /**
   * Emit `console.debug('[payload-redirects] …')` diagnostics (cache misses,
   * matches, and skips). Never logs request bodies; safe to leave on in staging.
   * @default false
   */
  debug?: boolean
  /**
   * Absolute base URL of the Payload API for split-origin deployments — where
   * the CMS lives on a different origin than the app serving redirects (e.g.
   * `'https://cms.example.com/api'`). When set, background refresh and
   * hit-tracking requests target `<endpointsBaseUrl><endpointsPath>/…`, ignoring
   * the request origin and `apiBasePath`. Leave unset for same-origin apps.
   */
  endpointsBaseUrl?: string
  /**
   * Must match the plugin's `endpointsPath` option.
   * @default '/payload-redirects'
   */
  endpointsPath?: string
  /**
   * Called for every issued redirect via `ctx.waitUntil` when available, else
   * fire-and-forget. Errors are swallowed — a failing hook never breaks routing.
   * `url` is the request URL the resolver matched against.
   */
  onRedirect?: (args: {
    destination: string
    redirect: CachedRedirect
    url: URL
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
   * Append a trailing slash to the path part of relative destinations
   * (`/about?x=1#f` → `/about/?x=1#f`), so a `trailingSlash: true` app redirects
   * straight to the canonical URL instead of taking a second hop. Skipped when
   * the path is `/`, already ends with `/`, or its last segment looks like a
   * file (`/logo.png`). Absolute/external destinations are never touched.
   * @default false
   */
  trailingSlash?: boolean
}

/**
 * A resolved redirect, ready for an adapter to turn into a response. The
 * `destination` is relative or absolute EXACTLY as resolved (after
 * `forwardQuery` and `trailingSlash` are applied) — adapters absolutize it
 * against the request URL themselves.
 */
export type ResolvedRedirectResult = {
  destination: string
  redirect: CachedRedirect
  status: 301 | 302
}

/**
 * The resolver function returned by {@link createRedirectsResolver}. Pass a
 * `ctx.waitUntil` (Vercel/Cloudflare `waitUntil`, Next's `event.waitUntil`, …)
 * to anchor background refresh/hit-tracking work; without it those run
 * fire-and-forget.
 */
export type RedirectsResolver = (
  url: string | URL,
  ctx?: { waitUntil?: (promise: Promise<unknown>) => void },
) => Promise<null | ResolvedRedirectResult>

/**
 * The request handler returned by {@link createRedirectsRequestHandler}. Returns
 * a `Response` redirect for a matched request, or `null` to pass through.
 */
export type RedirectsRequestHandler = (
  request: Request,
  ctx?: { waitUntil?: (promise: Promise<unknown>) => void },
) => Promise<null | Response>

const SECRET_HEADER = 'x-payload-redirects-secret'

const toStatusCode = (type: CachedRedirect['type']) => Number(type) as 301 | 302

type Memo = { at: number; entries: CachedRedirect[] }

// `process` is a Node global, not a module import — reading it keeps the
// edge-bundle invariant (no `node:*` imports) while matching the historical
// default. Guarded so non-Node runtimes (Workers) don't throw on the reference.
const defaultCacheMemoMs =
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'production' ? 5000 : 0

/**
 * Builds a framework-agnostic redirect resolver. It owns the memoized cache
 * read, ordered matching (via `resolveRedirect`), `forwardQuery` merging,
 * optional trailing-slash normalization, and background refresh / hit-tracking
 * calls. A broken cache backend never throws — it reads as "no redirects".
 */
export const createRedirectsResolver = (options: RedirectsResolverOptions): RedirectsResolver => {
  const {
    apiBasePath = '/api',
    cache,
    cacheMemoMs = defaultCacheMemoMs,
    debug = false,
    endpointsBaseUrl,
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

  const endpointUrl = (requestUrl: URL, path: string): URL =>
    // Split-origin: target the absolute API base verbatim. Same-origin: resolve
    // `apiBasePath + endpointsPath + path` against the request's own origin so
    // the request's path never leaks in.
    endpointsBaseUrl
      ? new URL(`${endpointsBaseUrl}${endpointsPath}${path}`)
      : new URL(`${apiBasePath}${endpointsPath}${path}`, requestUrl.origin)

  const postEndpoint = async (requestUrl: URL, path: string) => {
    const response = await fetch(endpointUrl(requestUrl, path), {
      cache: 'no-store',
      method: 'POST',
      ...(secret ? { headers: { [SECRET_HEADER]: secret } } : {}),
    })
    if (!response.ok) {
      throw new Error(`[payload-redirects] POST ${path} failed with ${response.status}`)
    }
  }

  const runInBackground = (
    ctx: { waitUntil?: (promise: Promise<unknown>) => void } | undefined,
    run: () => Promise<unknown>,
  ) => {
    const task = run()
    if (ctx?.waitUntil) {
      ctx.waitUntil(task)
    } else {
      // Fire-and-forget: without a waitUntil there is nothing to anchor the
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

  return async (url, ctx) => {
    let requestUrl: URL
    try {
      requestUrl = typeof url === 'string' ? new URL(url, 'https://payload.local') : url
    } catch {
      return null
    }

    const entries = await readEntries()

    if (entries === 'error') {
      return null
    }

    if (entries === null) {
      log('cache miss')
      if (refreshOnMiss) {
        runInBackground(ctx, () => postEndpoint(requestUrl, '/refresh-cache'))
      }
      return null
    }

    if (entries.length === 0) {
      return null
    }

    const resolved = resolveRedirect(
      entries,
      requestUrl,
      debug
        ? {
            onSkip: ({ destination, reason, redirect }) => {
              log(`skipped "${redirect.from}" -> "${destination}": ${reason}`)
            },
          }
        : undefined,
    )
    if (!resolved) {
      return null
    }

    const { redirect } = resolved
    let destination = redirect.forwardQuery
      ? mergeForwardedQuery(resolved.destination, requestUrl.search)
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

    if (trackHits) {
      runInBackground(ctx, () => postEndpoint(requestUrl, `/hit/${redirect.id}`))
    }

    if (onRedirect) {
      runInBackground(ctx, async () => {
        try {
          await onRedirect({ destination, redirect, url: requestUrl })
        } catch {
          // A failing hook must never affect routing, on any code path.
        }
      })
    }

    return { destination, redirect, status }
  }
}

/**
 * Builds a WHATWG request handler over {@link createRedirectsResolver}. Returns
 * a `Response` redirect (relative destinations are absolutized against the
 * request URL) for a matched request, or `null` to pass through — compose it
 * into any fetch-based framework:
 *
 * ```ts
 * // Cloudflare Worker
 * import { createRedirectsRequestHandler } from '@whatworks/payload-redirects/resolver'
 * import { cache } from './redirects-cache'
 *
 * const redirects = createRedirectsRequestHandler({ cache })
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     return (await redirects(request, ctx)) ?? fetch(request)
 *   },
 * }
 * ```
 */
export const createRedirectsRequestHandler = (
  options: RedirectsResolverOptions,
): RedirectsRequestHandler => {
  const resolve = createRedirectsResolver(options)

  return async (request, ctx) => {
    const result = await resolve(request.url, ctx)
    if (!result) {
      return null
    }
    return Response.redirect(new URL(result.destination, request.url), result.status)
  }
}

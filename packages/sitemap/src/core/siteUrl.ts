/**
 * Context a site URL can be derived from when nothing is configured. `request`
 * structurally accepts a Fetch `Request`, a `PayloadRequest`, or — in contexts
 * without a request object (e.g. Next metadata routes) — a bare
 * `{ headers: await headers() }`.
 */
export type SiteUrlContext = {
  /** The incoming request. */
  request?: { headers?: Headers; url?: null | string }
}

const validateSiteUrl = (raw: string, source: string): string => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `[payload-sitemap] Invalid siteUrl "${raw}" (from ${source}) — expected an absolute URL like https://example.com`,
    )
  }
  const basePath = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${basePath}`
}

const LOCAL_HOST = /^(?:localhost|127\.|0\.0\.0\.0|\[::1\])/

/**
 * Origin of the incoming request: proxy headers first (they carry the public host
 * when the server sits behind one), then the request URL. Host headers are
 * client-controlled: responses built from them must never be written to a shared
 * cache (entries are cached as site-relative paths for this reason).
 */
export const siteUrlFromRequest = (ctx: SiteUrlContext): string | undefined => {
  const headers = ctx.request?.headers
  // `||`, not `??`: an empty forwarded header must fall through, not win.
  const host = headers?.get('x-forwarded-host')?.split(',')[0]?.trim() || headers?.get('host')
  if (host) {
    const proto =
      headers?.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
      (LOCAL_HOST.test(host) ? 'http' : 'https')
    return `${proto}://${host}`
  }
  if (ctx.request?.url) {
    try {
      return new URL(ctx.request.url).origin
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Collapses a resolved config's `siteUrl` — a pinned origin string, or a
 * per-context resolver — into the origin for the given context.
 */
export const siteUrlFromConfig = (
  siteUrl: ((ctx?: SiteUrlContext) => string) | string,
  ctx?: SiteUrlContext,
): string => (typeof siteUrl === 'string' ? siteUrl : siteUrl(ctx))

/**
 * Site origin from environment variables, for contexts with no usable request:
 * SITE_URL → NEXT_PUBLIC_SERVER_URL → https://$VERCEL_PROJECT_PRODUCTION_URL.
 * Vercel's project URL comes last: it is derived (and frozen at build time),
 * not configured.
 */
const siteUrlFromEnv = (): string | undefined => {
  if (process.env.SITE_URL) {
    return validateSiteUrl(process.env.SITE_URL, 'SITE_URL')
  }
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    return validateSiteUrl(process.env.NEXT_PUBLIC_SERVER_URL, 'NEXT_PUBLIC_SERVER_URL')
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return validateSiteUrl(
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      'VERCEL_PROJECT_PRODUCTION_URL',
    )
  }
  return undefined
}

/**
 * Resolves the canonical frontend origin: explicit option → the incoming
 * request → SITE_URL → NEXT_PUBLIC_SERVER_URL → VERCEL_PROJECT_PRODUCTION_URL.
 *
 * The request outranks environment variables so a zero-config deployment
 * reachable on several domains mirrors whichever host each sitemap was
 * requested on; set the `siteUrl` option to pin one canonical domain.
 */
export const resolveSiteUrl = (
  configured?: ((ctx: SiteUrlContext) => string) | string,
  ctx?: SiteUrlContext,
): string => {
  if (typeof configured === 'function') {
    return validateSiteUrl(configured(ctx ?? {}), 'the siteUrl function')
  }
  if (configured) {
    return validateSiteUrl(configured, 'the siteUrl option')
  }

  const fromRequest = ctx && siteUrlFromRequest(ctx)
  if (fromRequest) {
    return validateSiteUrl(fromRequest, 'the incoming request')
  }

  const fromEnv = siteUrlFromEnv()
  if (fromEnv) {
    return fromEnv
  }

  throw new Error(
    '[payload-sitemap] No siteUrl available. Set the `siteUrl` plugin option, one of the SITE_URL / NEXT_PUBLIC_SERVER_URL environment variables, or call from a context with an incoming request.',
  )
}

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
  const host = headers?.get('x-forwarded-host')?.split(',')[0]?.trim() ?? headers?.get('host')
  if (host) {
    const proto =
      headers?.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
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
 * Resolves the site origin from explicit configuration or environment variables.
 * Returns `undefined` when neither is set (the caller may then fall back to the
 * request). Env vars win over request headers so that deployments reachable via
 * non-canonical aliases (e.g. *.vercel.app) still emit the canonical domain.
 */
export const resolveStaticSiteUrl = (configured?: string): string | undefined => {
  if (configured) {
    return validateSiteUrl(configured, 'the siteUrl option')
  }
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
 * Resolves the canonical frontend origin: explicit option → SITE_URL →
 * NEXT_PUBLIC_SERVER_URL → VERCEL_PROJECT_PRODUCTION_URL → the incoming
 * request, when available.
 */
export const resolveSiteUrl = (
  configured?: ((ctx: SiteUrlContext) => string) | string,
  ctx?: SiteUrlContext,
): string => {
  if (typeof configured === 'function') {
    return validateSiteUrl(configured(ctx ?? {}), 'the siteUrl function')
  }

  const staticUrl = resolveStaticSiteUrl(configured)
  if (staticUrl) {
    return staticUrl
  }

  const fromRequest = ctx && siteUrlFromRequest(ctx)
  if (fromRequest) {
    return validateSiteUrl(fromRequest, 'the incoming request')
  }

  throw new Error(
    '[payload-sitemap] No siteUrl available. Set the `siteUrl` plugin option, one of the SITE_URL / NEXT_PUBLIC_SERVER_URL environment variables, or call from a context with an incoming request.',
  )
}

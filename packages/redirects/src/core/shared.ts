/**
 * Runtime-agnostic primitives shared by the Payload plugin (cache writer) and
 * the Next.js middleware (cache reader). Nothing in this module may import
 * `payload` or Node built-ins — it must stay importable from edge bundles.
 */

/** Base path of the plugin's REST endpoints under the Payload API route. */
export const DEFAULT_ENDPOINTS_PATH = '/payload-redirects'

export const DEFAULT_COLLECTION_SLUG = 'redirects'

export type RedirectType = '301' | '302'

/** The denormalized shape a redirect is cached as — everything the middleware needs. */
export type CachedRedirect = {
  /** Normalized pathname (+ optional search), or a regex source when `regex` is set. */
  from: string
  id: string
  regex?: boolean
  /** Resolved destination: path or absolute URL, with any `scrollTo` fragment applied. */
  to: string
  type: RedirectType
}

/**
 * Cache contract between the plugin and the middleware. Both sides must be
 * given the same adapter (backed by the same store) — the plugin writes the
 * full redirect list on every change, the middleware reads it per request.
 * `get` returns `null` on a miss; hooks re-sync on every redirect change, so
 * entries never need to expire.
 */
export interface RedirectsCache {
  get: () => Promise<CachedRedirect[] | null>
  set: (redirects: CachedRedirect[]) => Promise<void>
}

export const isCachedRedirect = (value: unknown): value is CachedRedirect => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CachedRedirect>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.from === 'string' &&
    typeof candidate.to === 'string' &&
    (candidate.type === '301' || candidate.type === '302') &&
    (candidate.regex === undefined || typeof candidate.regex === 'boolean')
  )
}

/** Collapses trailing slashes and guarantees a leading slash (`''` → `'/'`). */
export const normalizeRedirectPathname = (pathname: string): string => {
  const withoutTrailingSlash = pathname.replace(/\/+$/, '')

  if (!withoutTrailingSlash) {
    return '/'
  }

  return withoutTrailingSlash.startsWith('/') ? withoutTrailingSlash : `/${withoutTrailingSlash}`
}

/**
 * Normalizes a user-entered "from" value to `pathname(+search)` — absolute
 * URLs are reduced to their path so `https://example.com/old/` and `/old`
 * match the same requests. Throws on unparseable input.
 */
export const normalizeRedirectFrom = (value: string): string => {
  const trimmed = value.trim()
  const url =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(trimmed, 'https://payload.local')

  return `${normalizeRedirectPathname(url.pathname)}${url.search}`
}

/**
 * The candidate strings a request is matched against: `path?search` first
 * (most specific), then the bare path so query-less redirects still match
 * requests that carry tracking params and the like.
 */
export const getNormalizedRequestTargets = ({
  pathname,
  search,
}: {
  pathname: string
  search: string
}): string[] => {
  const normalizedPath = normalizeRedirectPathname(pathname)

  if (!search) {
    return [normalizedPath]
  }

  const normalizedPathWithSearch = `${normalizedPath}${search}`

  return normalizedPathWithSearch === normalizedPath
    ? [normalizedPath]
    : [normalizedPathWithSearch, normalizedPath]
}

/**
 * Normalizes a user-entered element id into a bare fragment id, tolerating an
 * optional leading `#`. Returns `''` for empty/non-string input.
 */
export const normalizeScrollTo = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().replace(/^#+/, '')
}

/**
 * Appends `#<id>` to a destination, replacing any fragment the destination
 * already carries — an explicit `scrollTo` wins over a hash typed into a
 * custom URL. No-op when `scrollTo` is empty.
 */
export const applyScrollTo = (to: string, scrollTo: unknown): string => {
  const fragment = normalizeScrollTo(scrollTo)
  if (!fragment) {
    return to
  }

  const hashIndex = to.indexOf('#')
  const base = hashIndex === -1 ? to : to.slice(0, hashIndex)
  return `${base}#${fragment}`
}

/**
 * Tests a redirect against the request targets and returns the resolved
 * destination, or `null` when it doesn't match. Regex redirects substitute
 * capture groups referenced as `$1`, `$2`, … in the destination (unmatched
 * groups become `''`); invalid regex sources never match.
 */
export const matchRedirect = (redirect: CachedRedirect, targets: string[]): null | string => {
  if (!redirect.regex) {
    return targets.includes(redirect.from) ? redirect.to : null
  }

  let pattern: RegExp
  try {
    pattern = new RegExp(redirect.from)
  } catch {
    return null
  }

  for (const target of targets) {
    const match = pattern.exec(target)
    if (match) {
      return redirect.to.replace(/\$(\d+)/g, (_token, group) => match[Number(group)] ?? '')
    }
  }

  return null
}

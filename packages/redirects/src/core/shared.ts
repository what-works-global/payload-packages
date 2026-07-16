/**
 * Runtime-agnostic primitives shared by the Payload plugin (cache writer) and
 * the Next.js middleware (cache reader). Nothing in this module may import
 * `payload` or Node built-ins — it must stay importable from edge bundles.
 */

/** Base path of the plugin's REST endpoints under the Payload API route. */
export const DEFAULT_ENDPOINTS_PATH = '/payload-redirects'

export const DEFAULT_COLLECTION_SLUG = 'redirects'

export type RedirectType = '301' | '302'

/** How a request path is compared against a redirect's `from`. */
export type RedirectMatchType = 'contains' | 'endsWith' | 'exact' | 'regex' | 'startsWith'

const NON_EXACT_MATCH_TYPES = ['contains', 'endsWith', 'regex', 'startsWith'] as const

/** The denormalized shape a redirect is cached as — everything the middleware needs. */
export type CachedRedirect = {
  /** Emitted only when `true`; matching lowercases both sides. */
  caseInsensitive?: true
  /** Emitted only when `true`; merges the request query into the destination. */
  forwardQuery?: true
  /** Canonicalized path (+ optional search), a substring, or a regex source per `match`. */
  from: string
  id: string
  /** Informational — set when the plugin runs with `localized: true`. */
  locale?: string
  /** Absent means an exact-path match; otherwise how `from` is compared. */
  match?: 'contains' | 'endsWith' | 'regex' | 'startsWith'
  /** Resolved destination: path or absolute URL, with any `scrollTo` fragment applied. */
  to: string
  type: RedirectType
}

/** The result of resolving a request against the cached redirect list. */
export type ResolvedRedirect = {
  /** Final destination, with regex capture groups substituted. */
  destination: string
  redirect: CachedRedirect
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
    (candidate.match === undefined ||
      (NON_EXACT_MATCH_TYPES as readonly string[]).includes(candidate.match)) &&
    (candidate.caseInsensitive === undefined || candidate.caseInsensitive === true) &&
    (candidate.forwardQuery === undefined || candidate.forwardQuery === true) &&
    (candidate.locale === undefined || typeof candidate.locale === 'string')
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

/** Uppercases the hex digits of every `%xx` escape so casing never affects matching. */
const uppercasePercentEncoding = (value: string): string =>
  value.replace(/%[0-9a-f]{2}/gi, (match) => match.toUpperCase())

/**
 * Canonicalizes a pathname: percent-encodes raw unicode (via `URL`), uppercases
 * `%xx` escapes, then collapses trailing slashes. Case of literal characters is
 * preserved — case-insensitivity is a per-entry match-time concern.
 */
export const canonicalizePathname = (pathname: string): string => {
  let encoded: string
  try {
    encoded = new URL(pathname, 'https://payload.local').pathname
  } catch {
    encoded = pathname
  }
  return normalizeRedirectPathname(uppercasePercentEncoding(encoded))
}

/**
 * Canonicalizes a query string so equivalent queries compare equal: keys are
 * sorted (stable — repeated keys keep their relative order) and re-serialized.
 * Returns `''` for an empty/`?`-only search, otherwise a `?`-prefixed string.
 */
export const canonicalizeSearch = (search: string): string => {
  if (!search || search === '?') {
    return ''
  }
  const params = new URLSearchParams(search)
  params.sort()
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

/**
 * Normalizes a user-entered "from" value to canonical `pathname(+search)` —
 * absolute URLs are reduced to their path so `https://example.com/old/` and
 * `/old` match the same requests. Throws on unparseable input.
 */
export const normalizeRedirectFrom = (value: string): string => {
  const trimmed = value.trim()
  const url =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(trimmed, 'https://payload.local')

  const path = normalizeRedirectPathname(uppercasePercentEncoding(url.pathname))
  return `${path}${canonicalizeSearch(url.search)}`
}

/**
 * The candidate strings a request is matched against: `path?search` first
 * (most specific), then the bare path so query-less redirects still match
 * requests that carry tracking params and the like. Both are canonicalized
 * identically to stored `from` values.
 */
export const getNormalizedRequestTargets = ({
  pathname,
  search,
}: {
  pathname: string
  search: string
}): string[] => {
  const normalizedPath = canonicalizePathname(pathname)
  const canonicalSearch = canonicalizeSearch(search)

  if (!canonicalSearch) {
    return [normalizedPath]
  }

  const normalizedPathWithSearch = `${normalizedPath}${canonicalSearch}`

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

/** Strips a `#fragment` from a URL/path, leaving `path?search`. */
export const stripFragment = (value: string): string => {
  const index = value.indexOf('#')
  return index === -1 ? value : value.slice(0, index)
}

/**
 * Tests a redirect against the request targets and returns the resolved
 * destination, or `null` when it doesn't match. Regex redirects substitute
 * capture groups referenced as `$1`, `$2`, … in the destination (unmatched
 * groups become `''`); invalid regex sources never match. Other match types
 * have a fixed destination. `caseInsensitive` lowercases both sides (regex
 * uses the `i` flag).
 */
export const matchRedirect = (redirect: CachedRedirect, targets: string[]): null | string => {
  const caseInsensitive = redirect.caseInsensitive === true

  if (redirect.match === 'regex') {
    let pattern: RegExp
    try {
      pattern = new RegExp(redirect.from, caseInsensitive ? 'i' : '')
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

  const from = caseInsensitive ? redirect.from.toLowerCase() : redirect.from

  for (const target of targets) {
    const candidate = caseInsensitive ? target.toLowerCase() : target

    if (redirect.match === 'startsWith') {
      if (candidate.startsWith(from)) {
        return redirect.to
      }
    } else if (redirect.match === 'endsWith') {
      if (candidate.endsWith(from)) {
        return redirect.to
      }
    } else if (redirect.match === 'contains') {
      if (candidate.includes(from)) {
        return redirect.to
      }
    } else if (candidate === from) {
      // `match` is absent → exact path match.
      return redirect.to
    }
  }

  return null
}

/**
 * Open-redirect guard. When the STORED destination is a relative path (begins
 * with `/`), the FINAL destination (after regex substitution) must be a plain
 * absolute path — it may not begin with `//` or `/\`, which browsers treat as
 * protocol-relative URLs to another origin. Blocks patterns like
 * `^/r/(.+)$` → `/$1` turning `/r//evil.com` into `https://evil.com`.
 */
const isSafeDestination = (storedTo: string, finalDestination: string): boolean => {
  if (!storedTo.startsWith('/')) {
    return true
  }
  return /^\/(?![/\\])/.test(finalDestination)
}

/** The canonical `path?search` of a destination (fragment ignored, host discarded). */
const destinationPathSearch = (destination: string): string => {
  try {
    const url = new URL(destination, 'https://payload.local')
    return `${canonicalizePathname(url.pathname)}${canonicalizeSearch(url.search)}`
  } catch {
    return stripFragment(destination)
  }
}

/**
 * Framework-agnostic redirect resolution — usable from Express, Hono, Next.js
 * middleware, or anything with a request URL. Scans the ordered list, returns
 * the first safe, non-looping match, or `null`. Does NOT apply `forwardQuery`
 * (that needs the full request URL to join against — see `mergeForwardedQuery`).
 */
export const resolveRedirect = (
  redirects: CachedRedirect[],
  url: string | URL,
): null | ResolvedRedirect => {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url, 'https://payload.local') : url
  } catch {
    return null
  }

  const targets = getNormalizedRequestTargets({
    pathname: parsed.pathname,
    search: parsed.search,
  })
  const requestPathSearch = `${canonicalizePathname(parsed.pathname)}${canonicalizeSearch(parsed.search)}`

  for (const redirect of redirects) {
    const destination = matchRedirect(redirect, targets)
    if (destination === null) {
      continue
    }

    // Security: reject destinations that would escape to another origin.
    if (!isSafeDestination(redirect.to, destination)) {
      continue
    }

    // Self-redirect skip. Fragments are ignored on purpose: they are never
    // sent to the server, so `/pricing` → `/pricing#plans` would loop.
    if (destinationPathSearch(destination) === requestPathSearch) {
      continue
    }

    return { destination, redirect }
  }

  return null
}

/**
 * Merges the incoming request query into a destination: the destination's own
 * params always win, and request params whose key isn't already present are
 * appended. The destination's fragment position is preserved (`/x?a=1#f`).
 */
export const mergeForwardedQuery = (destination: string, requestSearch: string): string => {
  if (!requestSearch || requestSearch === '?') {
    return destination
  }

  const hashIndex = destination.indexOf('#')
  const fragment = hashIndex === -1 ? '' : destination.slice(hashIndex)
  const base = hashIndex === -1 ? destination : destination.slice(0, hashIndex)

  const queryIndex = base.indexOf('?')
  const path = queryIndex === -1 ? base : base.slice(0, queryIndex)
  const destinationSearch = queryIndex === -1 ? '' : base.slice(queryIndex)

  const params = new URLSearchParams(destinationSearch)
  const existingKeys = new Set(params.keys())

  const incoming = new URLSearchParams(requestSearch)
  for (const [key, value] of incoming.entries()) {
    if (!existingKeys.has(key)) {
      params.append(key, value)
    }
  }

  const merged = params.toString()
  return `${path}${merged ? `?${merged}` : ''}${fragment}`
}

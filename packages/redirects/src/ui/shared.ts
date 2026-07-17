/**
 * Pure, React-free helpers for the redirect admin UI, split out so they can be
 * unit-tested without importing the admin runtime (`@payloadcms/ui`, React).
 */

/**
 * The href to open when testing a redirect, or `null` when the "From" value
 * isn't openable. Absolute http(s) URLs and root-relative paths are returned
 * verbatim (trimmed) — a root-relative href resolves against the current page's
 * origin, so an `<a href>` needs no base. Regex `from` values are patterns rather
 * than URLs, and substrings that don't start with `/` (from `contains`/`endsWith`
 * matches) can't be turned into a request — both return `null`.
 */
export const testRedirectHref = (
  from: null | string | undefined,
  matchType: null | string | undefined,
): null | string => {
  const trimmed = typeof from === 'string' ? from.trim() : ''
  if (!trimmed) {
    return null
  }

  // A regex "From" is a pattern, not a URL — there is nothing concrete to open.
  if (matchType === 'regex') {
    return null
  }

  // An absolute http(s) URL opens as-is.
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null
  } catch {
    // Not an absolute URL — fall through to the root-relative check.
  }

  // A root-relative path resolves against the page origin inside an `<a href>`.
  return trimmed.startsWith('/') ? trimmed : null
}

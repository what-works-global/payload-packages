/**
 * Pure, React-free helpers for the redirect list cells, split out so they can be
 * unit-tested without importing the admin runtime (`@payloadcms/ui`, React).
 */

/**
 * Whether a custom-URL destination should be rendered as a hyperlink. A regex
 * redirect substitutes `$1`, `$2`, … in its destination with capture groups at
 * match time, so a destination that references any is incomplete until then and
 * must be shown as plain text. Everything else is a real URL and links — a regex
 * redirect with a fixed destination (no `$n`), and a literal `$n` in a non-regex
 * destination (never substituted).
 */
export const isLinkableCustomDestination = (url: string, matchType: string): boolean =>
  !(matchType === 'regex' && /\$\d/.test(url))

import { describe, expect, it } from 'vitest'

import { testRedirectHref } from '../src/ui/shared.js'

describe('testRedirectHref', () => {
  it('returns a root-relative path verbatim (an anchor resolves it against the origin)', () => {
    expect(testRedirectHref('/old-page', 'exact')).toBe('/old-page')
    expect(testRedirectHref('/old-page?ref=1#top', 'exact')).toBe('/old-page?ref=1#top')
    // Defaults to testable when no match type is supplied.
    expect(testRedirectHref('/old-page', undefined)).toBe('/old-page')
  })

  it('returns absolute http(s) URLs as-is', () => {
    expect(testRedirectHref('https://example.com/moved', 'exact')).toBe('https://example.com/moved')
    expect(testRedirectHref('http://example.com/moved', 'exact')).toBe('http://example.com/moved')
  })

  it('accepts non-regex substring matches that start with a slash', () => {
    expect(testRedirectHref('/blog', 'startsWith')).toBe('/blog')
    expect(testRedirectHref('/legacy', 'endsWith')).toBe('/legacy')
  })

  it('trims surrounding whitespace', () => {
    expect(testRedirectHref('  /old-page  ', 'exact')).toBe('/old-page')
  })

  it('returns null for empty, whitespace-only, and nullish values', () => {
    expect(testRedirectHref('', 'exact')).toBeNull()
    expect(testRedirectHref('   ', 'exact')).toBeNull()
    expect(testRedirectHref(null, 'exact')).toBeNull()
    expect(testRedirectHref(undefined, 'exact')).toBeNull()
  })

  it('returns null for non-path substrings', () => {
    // A `contains` fragment without a leading slash isn't a request to open.
    expect(testRedirectHref('promo', 'contains')).toBeNull()
  })

  it('returns null for regex patterns — they are patterns, not URLs', () => {
    expect(testRedirectHref('^/foo/(.*)$', 'regex')).toBeNull()
    expect(testRedirectHref('/foo', 'regex')).toBeNull()
  })

  it('returns null for non-http protocols', () => {
    expect(testRedirectHref('mailto:hi@example.com', 'exact')).toBeNull()
    expect(testRedirectHref('ftp://example.com/file', 'exact')).toBeNull()
  })
})

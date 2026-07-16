import { describe, expect, it } from 'vitest'

import type { CachedRedirect } from '../src/index.js'

import {
  applyScrollTo,
  canonicalizeSearch,
  getNormalizedRequestTargets,
  isCachedRedirect,
  matchRedirect,
  mergeForwardedQuery,
  normalizeRedirectFrom,
  normalizeRedirectPathname,
  normalizeScrollTo,
  resolveRedirect,
  stripFragment,
} from '../src/index.js'

describe('normalizeRedirectPathname', () => {
  it('collapses trailing slashes and guarantees a leading slash', () => {
    expect(normalizeRedirectPathname('/old/')).toBe('/old')
    expect(normalizeRedirectPathname('/old///')).toBe('/old')
    expect(normalizeRedirectPathname('old')).toBe('/old')
    expect(normalizeRedirectPathname('/')).toBe('/')
    expect(normalizeRedirectPathname('')).toBe('/')
  })
})

describe('normalizeRedirectFrom', () => {
  it('reduces absolute URLs to their path and search', () => {
    expect(normalizeRedirectFrom('https://example.com/old/')).toBe('/old')
    expect(normalizeRedirectFrom('http://example.com/old?a=1')).toBe('/old?a=1')
  })

  it('normalizes relative paths', () => {
    expect(normalizeRedirectFrom(' /old/ ')).toBe('/old')
    expect(normalizeRedirectFrom('old-page')).toBe('/old-page')
    expect(normalizeRedirectFrom('/old?utm=x')).toBe('/old?utm=x')
  })

  it('canonicalizes query parameter order (stable for repeated keys)', () => {
    expect(normalizeRedirectFrom('/x?b=2&a=1')).toBe('/x?a=1&b=2')
    expect(normalizeRedirectFrom('/x?a=2&a=1')).toBe('/x?a=2&a=1')
  })

  it('percent-encodes raw unicode and uppercases existing escapes', () => {
    expect(normalizeRedirectFrom('/café')).toBe('/caf%C3%A9')
    expect(normalizeRedirectFrom('/caf%c3%a9')).toBe('/caf%C3%A9')
  })
})

describe('canonicalizeSearch', () => {
  it('sorts keys and normalizes empty searches', () => {
    expect(canonicalizeSearch('?b=2&a=1')).toBe('?a=1&b=2')
    expect(canonicalizeSearch('')).toBe('')
    expect(canonicalizeSearch('?')).toBe('')
  })
})

describe('getNormalizedRequestTargets', () => {
  it('returns the bare path without a search', () => {
    expect(getNormalizedRequestTargets({ pathname: '/old/', search: '' })).toEqual(['/old'])
  })

  it('returns canonicalized path+search first, then the bare path', () => {
    expect(getNormalizedRequestTargets({ pathname: '/old', search: '?b=2&a=1' })).toEqual([
      '/old?a=1&b=2',
      '/old',
    ])
  })
})

describe('stripFragment', () => {
  it('removes a trailing fragment', () => {
    expect(stripFragment('/a#b')).toBe('/a')
    expect(stripFragment('/a?x=1#b')).toBe('/a?x=1')
    expect(stripFragment('/a')).toBe('/a')
  })
})

describe('scrollTo helpers', () => {
  it('normalizes user-entered element ids', () => {
    expect(normalizeScrollTo('#team')).toBe('team')
    expect(normalizeScrollTo('##team')).toBe('team')
    expect(normalizeScrollTo('  team  ')).toBe('team')
    expect(normalizeScrollTo('')).toBe('')
    expect(normalizeScrollTo(undefined)).toBe('')
    expect(normalizeScrollTo(7)).toBe('')
  })

  it('appends the fragment to a destination', () => {
    expect(applyScrollTo('/about', 'team')).toBe('/about#team')
    expect(applyScrollTo('/about', '#team')).toBe('/about#team')
    expect(applyScrollTo('https://example.com/about?x=1', 'team')).toBe(
      'https://example.com/about?x=1#team',
    )
  })

  it('replaces a fragment the destination already carries', () => {
    expect(applyScrollTo('/about#old', 'new')).toBe('/about#new')
  })

  it('is a no-op without a fragment', () => {
    expect(applyScrollTo('/about', '')).toBe('/about')
    expect(applyScrollTo('/about#kept', undefined)).toBe('/about#kept')
  })
})

describe('matchRedirect', () => {
  const base = { id: '1', type: '301' } as const

  it('matches exact targets', () => {
    const redirect: CachedRedirect = { ...base, from: '/old', to: '/new' }
    expect(matchRedirect(redirect, ['/old'])).toBe('/new')
    expect(matchRedirect(redirect, ['/old?a=1', '/old'])).toBe('/new')
    expect(matchRedirect(redirect, ['/other'])).toBeNull()
  })

  it('matches startsWith / endsWith / contains', () => {
    const startsWith: CachedRedirect = { ...base, from: '/blog', match: 'startsWith', to: '/news' }
    expect(matchRedirect(startsWith, ['/blog/hello'])).toBe('/news')
    expect(matchRedirect(startsWith, ['/other'])).toBeNull()

    const endsWith: CachedRedirect = { ...base, from: '.html', match: 'endsWith', to: '/clean' }
    expect(matchRedirect(endsWith, ['/page.html'])).toBe('/clean')
    expect(matchRedirect(endsWith, ['/page'])).toBeNull()

    const contains: CachedRedirect = { ...base, from: 'promo', match: 'contains', to: '/sale' }
    expect(matchRedirect(contains, ['/summer-promo-2024'])).toBe('/sale')
    expect(matchRedirect(contains, ['/summer-2024'])).toBeNull()
  })

  it('matches case-insensitively for literal and regex matches', () => {
    const exact: CachedRedirect = { ...base, caseInsensitive: true, from: '/Old', to: '/new' }
    expect(matchRedirect(exact, ['/old'])).toBe('/new')

    const regex: CachedRedirect = {
      ...base,
      caseInsensitive: true,
      from: '^/Blog/(.+)$',
      match: 'regex',
      to: '/news/$1',
    }
    expect(matchRedirect(regex, ['/blog/hello'])).toBe('/news/hello')
  })

  it('matches regex redirects against each target', () => {
    const redirect: CachedRedirect = { ...base, from: '^/blog/.+$', match: 'regex', to: '/news' }
    expect(matchRedirect(redirect, ['/blog/hello'])).toBe('/news')
    expect(matchRedirect(redirect, ['/blog'])).toBeNull()
  })

  it('substitutes capture groups into the destination', () => {
    const redirect: CachedRedirect = {
      ...base,
      from: '^/blog/([^/]+)/([^/]+)$',
      match: 'regex',
      to: '/news/$2/$1',
    }
    expect(matchRedirect(redirect, ['/blog/2024/hello'])).toBe('/news/hello/2024')
  })

  it('substitutes unmatched groups as empty strings', () => {
    const redirect: CachedRedirect = {
      ...base,
      from: '^/docs(/.*)?$',
      match: 'regex',
      to: '/help$1',
    }
    expect(matchRedirect(redirect, ['/docs'])).toBe('/help')
    expect(matchRedirect(redirect, ['/docs/install'])).toBe('/help/install')
  })

  it('never matches invalid regex sources', () => {
    const redirect: CachedRedirect = { ...base, from: '([', match: 'regex', to: '/new' }
    expect(matchRedirect(redirect, ['(['])).toBeNull()
  })
})

describe('resolveRedirect', () => {
  const base = { id: '1', type: '301' } as const

  it('returns the first matching redirect in order', () => {
    const redirects: CachedRedirect[] = [
      { ...base, id: 'a', from: '/blog', match: 'startsWith', to: '/first' },
      { ...base, id: 'b', from: '/blog/post', to: '/second' },
    ]
    const resolved = resolveRedirect(redirects, 'https://site.com/blog/post')
    expect(resolved?.destination).toBe('/first')
    expect(resolved?.redirect.id).toBe('a')
  })

  it('resolves regex substitutions from a URL string', () => {
    const redirects: CachedRedirect[] = [
      { ...base, from: '^/blog/(.+)$', match: 'regex', to: '/news/$1' },
    ]
    expect(resolveRedirect(redirects, 'https://site.com/blog/hello')?.destination).toBe(
      '/news/hello',
    )
  })

  it('skips self-redirects, including fragment-only differences', () => {
    const redirects: CachedRedirect[] = [{ ...base, from: '/pricing', to: '/pricing#plans' }]
    expect(resolveRedirect(redirects, 'https://site.com/pricing')).toBeNull()
  })

  it('rejects open-redirect destinations that escape the origin', () => {
    const redirects: CachedRedirect[] = [{ ...base, from: '^/r/(.+)$', match: 'regex', to: '/$1' }]
    // `/r//evil.com` → `//evil.com`, which browsers treat as protocol-relative.
    expect(resolveRedirect(redirects, 'https://site.com/r//evil.com')).toBeNull()
    // A safe capture still resolves.
    expect(resolveRedirect(redirects, 'https://site.com/r/safe')?.destination).toBe('/safe')
  })

  it('returns null when nothing matches', () => {
    expect(
      resolveRedirect([{ ...base, from: '/old', to: '/new' }], 'https://site.com/x'),
    ).toBeNull()
  })
})

describe('mergeForwardedQuery', () => {
  it('appends request params the destination lacks, destination wins on conflict', () => {
    expect(mergeForwardedQuery('/dest', '?a=1')).toBe('/dest?a=1')
    expect(mergeForwardedQuery('/dest?a=1', '?a=2&b=3')).toBe('/dest?a=1&b=3')
  })

  it('preserves the destination fragment position', () => {
    expect(mergeForwardedQuery('/x?a=1#f', '?b=2')).toBe('/x?a=1&b=2#f')
  })

  it('is a no-op for an empty request search', () => {
    expect(mergeForwardedQuery('/dest?a=1', '')).toBe('/dest?a=1')
    expect(mergeForwardedQuery('/dest', '?')).toBe('/dest')
  })
})

describe('isCachedRedirect', () => {
  it('accepts well-formed entries and rejects everything else', () => {
    expect(isCachedRedirect({ id: '1', type: '301', from: '/a', to: '/b' })).toBe(true)
    expect(isCachedRedirect({ id: '1', type: '302', from: '^/a$', match: 'regex', to: '/b' })).toBe(
      true,
    )
    expect(
      isCachedRedirect({
        id: '1',
        type: '301',
        caseInsensitive: true,
        forwardQuery: true,
        from: '/a',
        locale: 'en',
        match: 'startsWith',
        to: '/b',
      }),
    ).toBe(true)
    // Invalid literal for match.
    expect(isCachedRedirect({ id: '1', type: '301', from: '/a', match: 'nope', to: '/b' })).toBe(
      false,
    )
    // Boolean flags must be `true` when present, never `false`.
    expect(
      isCachedRedirect({ id: '1', type: '301', caseInsensitive: false, from: '/a', to: '/b' }),
    ).toBe(false)
    expect(isCachedRedirect({ id: '1', type: '307', from: '/a', to: '/b' })).toBe(false)
    expect(isCachedRedirect({ id: 1, type: '301', from: '/a', to: '/b' })).toBe(false)
    expect(isCachedRedirect({ id: '1', type: '301', from: '/a' })).toBe(false)
    expect(isCachedRedirect(null)).toBe(false)
    expect(isCachedRedirect('nope')).toBe(false)
  })
})

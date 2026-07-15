import { describe, expect, it } from 'vitest'

import {
  applyScrollTo,
  getNormalizedRequestTargets,
  isCachedRedirect,
  matchRedirect,
  normalizeRedirectFrom,
  normalizeRedirectPathname,
  normalizeScrollTo,
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
})

describe('getNormalizedRequestTargets', () => {
  it('returns the bare path without a search', () => {
    expect(getNormalizedRequestTargets({ pathname: '/old/', search: '' })).toEqual(['/old'])
  })

  it('returns path+search first, then the bare path', () => {
    expect(getNormalizedRequestTargets({ pathname: '/old', search: '?a=1' })).toEqual([
      '/old?a=1',
      '/old',
    ])
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
    const redirect = { ...base, from: '/old', to: '/new' }
    expect(matchRedirect(redirect, ['/old'])).toBe('/new')
    expect(matchRedirect(redirect, ['/old?a=1', '/old'])).toBe('/new')
    expect(matchRedirect(redirect, ['/other'])).toBeNull()
  })

  it('matches regex redirects against each target', () => {
    const redirect = { ...base, from: '^/blog/.+$', regex: true, to: '/news' }
    expect(matchRedirect(redirect, ['/blog/hello'])).toBe('/news')
    expect(matchRedirect(redirect, ['/blog'])).toBeNull()
  })

  it('substitutes capture groups into the destination', () => {
    const redirect = { ...base, from: '^/blog/([^/]+)/([^/]+)$', regex: true, to: '/news/$2/$1' }
    expect(matchRedirect(redirect, ['/blog/2024/hello'])).toBe('/news/hello/2024')
  })

  it('substitutes unmatched groups as empty strings', () => {
    const redirect = { ...base, from: '^/docs(/.*)?$', regex: true, to: '/help$1' }
    expect(matchRedirect(redirect, ['/docs'])).toBe('/help')
    expect(matchRedirect(redirect, ['/docs/install'])).toBe('/help/install')
  })

  it('never matches invalid regex sources', () => {
    const redirect = { ...base, from: '([', regex: true, to: '/new' }
    expect(matchRedirect(redirect, ['(['])).toBeNull()
  })
})

describe('isCachedRedirect', () => {
  it('accepts well-formed entries and rejects everything else', () => {
    expect(isCachedRedirect({ id: '1', type: '301', from: '/a', to: '/b' })).toBe(true)
    expect(isCachedRedirect({ id: '1', type: '302', from: '/a', regex: true, to: '/b' })).toBe(true)
    expect(isCachedRedirect({ id: '1', type: '307', from: '/a', to: '/b' })).toBe(false)
    expect(isCachedRedirect({ id: 1, type: '301', from: '/a', to: '/b' })).toBe(false)
    expect(isCachedRedirect({ id: '1', type: '301', from: '/a' })).toBe(false)
    expect(isCachedRedirect(null)).toBe(false)
    expect(isCachedRedirect('nope')).toBe(false)
  })
})

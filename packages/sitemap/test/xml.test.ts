import { describe, expect, it } from 'vitest'

import { formatLoc } from '../src/core/entries.js'
import { buildSitemapIndexXml, buildUrlsetXml, escapeXml } from '../src/core/xml.js'

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })
})

describe('buildUrlsetXml', () => {
  it('renders loc and lastmod', () => {
    const xml = buildUrlsetXml([
      { lastmod: '2026-01-01T00:00:00.000Z', loc: 'https://example.com/a?x=1&y=2' },
    ])
    expect(xml).toContain('<loc>https://example.com/a?x=1&amp;y=2</loc>')
    expect(xml).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
  })

  it('omits changefreq and priority unless provided', () => {
    const xml = buildUrlsetXml([{ loc: 'https://example.com/' }])
    expect(xml).not.toContain('<changefreq>')
    expect(xml).not.toContain('<priority>')
  })

  it('applies group defaults and lets per-entry values win', () => {
    const xml = buildUrlsetXml(
      [
        { loc: 'https://example.com/a' },
        { changefreq: 'daily', loc: 'https://example.com/b', priority: 0.9 },
      ],
      { changeFreq: 'weekly', priority: 0.5 },
    )
    expect(xml).toContain('<changefreq>weekly</changefreq>')
    expect(xml).toContain('<changefreq>daily</changefreq>')
    expect(xml).toContain('<priority>0.5</priority>')
    expect(xml).toContain('<priority>0.9</priority>')
  })

  it('renders priority 0 instead of dropping it', () => {
    const xml = buildUrlsetXml([{ loc: 'https://example.com/a', priority: 0 }])
    expect(xml).toContain('<priority>0</priority>')
  })
})

describe('buildSitemapIndexXml', () => {
  it('renders sitemap entries with lastmod', () => {
    const xml = buildSitemapIndexXml([
      { lastmod: '2026-01-01T00:00:00.000Z', loc: 'https://example.com/sitemaps/pages-1.xml' },
      { loc: 'https://example.com/sitemaps/posts-1.xml' },
    ])
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://example.com/sitemaps/pages-1.xml</loc>')
    expect(xml).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>')
  })
})

describe('formatLoc', () => {
  const site = 'https://example.com'

  it('joins paths onto the site URL and normalizes leading slashes', () => {
    expect(formatLoc('/about', site, false)).toBe('https://example.com/about')
    expect(formatLoc('about', site, false)).toBe('https://example.com/about')
  })

  it('keeps the root path as a single slash', () => {
    expect(formatLoc('/', site, false)).toBe('https://example.com/')
    expect(formatLoc('/', site, true)).toBe('https://example.com/')
  })

  it('applies the trailingSlash option', () => {
    expect(formatLoc('/about/', site, false)).toBe('https://example.com/about')
    expect(formatLoc('/about', site, true)).toBe('https://example.com/about/')
    expect(formatLoc('/about/', site, true)).toBe('https://example.com/about/')
  })

  it('passes absolute URLs through verbatim', () => {
    expect(formatLoc('https://other.example/x', site, true)).toBe('https://other.example/x')
  })
})

import { describe, expect, it } from 'vitest'

import { buildRobotsData, renderRobotsTxt } from '../src/core/robots.js'

const sitemaps = ['https://example.com/sitemap.xml']

describe('buildRobotsData', () => {
  it('disallows everything outside production', () => {
    const data = buildRobotsData({ options: { allowIndexing: false }, sitemaps })
    expect(data.rules).toEqual([{ disallow: '/', userAgent: '*' }])
    expect(data.sitemaps).toEqual([])
  })

  it('defaults to disallowing admin and API routes in production', () => {
    const data = buildRobotsData({
      adminRoute: '/admin',
      apiRoute: '/api',
      options: { allowIndexing: true },
      sitemaps,
    })
    expect(data.rules[0].disallow).toEqual(['/admin/', '/api/'])
    expect(data.sitemaps).toEqual(sitemaps)
  })

  it('appends extra disallow paths to the default rule', () => {
    const data = buildRobotsData({
      options: { allowIndexing: true, disallow: ['/drafts/'] },
      sitemaps,
    })
    expect(data.rules[0].disallow).toContain('/drafts/')
  })

  it('auto-allows sitemap URLs living under a disallowed prefix', () => {
    const data = buildRobotsData({
      options: { allowIndexing: true },
      sitemaps: ['https://cms.example.com/api/sitemap/index.xml'],
    })
    expect(data.rules[0].allow).toContain('/api/sitemap/index.xml')
  })

  it('lets `rules` replace the defaults entirely', () => {
    const rules = [{ disallow: ['/private/'], userAgent: 'Googlebot' }]
    const data = buildRobotsData({ options: { allowIndexing: true, rules }, sitemaps })
    expect(data.rules).toHaveLength(1)
    expect(data.rules[0].userAgent).toBe('Googlebot')
  })

  it('gives transform the final say', () => {
    const data = buildRobotsData({
      options: {
        allowIndexing: true,
        transform: (robots) => ({ ...robots, host: 'https://example.com' }),
      },
      sitemaps,
    })
    expect(data.host).toBe('https://example.com')
  })
})

describe('renderRobotsTxt', () => {
  it('renders rules, host, and sitemap lines', () => {
    const txt = renderRobotsTxt({
      host: 'https://example.com',
      rules: [
        { allow: ['/api/sitemap/index.xml'], disallow: ['/admin/', '/api/'], userAgent: '*' },
        { crawlDelay: 2, userAgent: ['Googlebot', 'Bingbot'] },
      ],
      sitemaps,
    })
    expect(txt).toBe(
      [
        'User-agent: *',
        'Allow: /api/sitemap/index.xml',
        'Disallow: /admin/',
        'Disallow: /api/',
        '',
        'User-agent: Googlebot',
        'User-agent: Bingbot',
        'Crawl-delay: 2',
        '',
        'Host: https://example.com',
        'Sitemap: https://example.com/sitemap.xml',
        '',
      ].join('\n'),
    )
  })
})

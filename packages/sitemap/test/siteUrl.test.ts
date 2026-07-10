import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveSiteUrl, siteUrlFromRequest } from '../src/core/siteUrl.js'

const ENV_KEYS = ['SITE_URL', 'NEXT_PUBLIC_SERVER_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved[key]
    }
  }
})

describe('resolveSiteUrl', () => {
  it('prefers the explicit option', () => {
    process.env.SITE_URL = 'https://env.example.com'
    expect(resolveSiteUrl('https://option.example.com')).toBe('https://option.example.com')
  })

  it('falls back through SITE_URL → NEXT_PUBLIC_SERVER_URL → VERCEL_PROJECT_PRODUCTION_URL without a request', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'vercel.example.com'
    expect(resolveSiteUrl()).toBe('https://vercel.example.com')

    process.env.NEXT_PUBLIC_SERVER_URL = 'https://next.example.com'
    expect(resolveSiteUrl()).toBe('https://next.example.com')

    process.env.SITE_URL = 'https://site.example.com'
    expect(resolveSiteUrl()).toBe('https://site.example.com')
  })

  it('strips trailing slashes but keeps base paths', () => {
    expect(resolveSiteUrl('https://example.com/')).toBe('https://example.com')
    expect(resolveSiteUrl('https://example.com/docs/')).toBe('https://example.com/docs')
  })

  it('throws a clear error when nothing is configured or the URL is invalid', () => {
    expect(() => resolveSiteUrl()).toThrow(/No siteUrl available/)
    expect(() => resolveSiteUrl('not-a-url')).toThrow(/Invalid siteUrl/)
  })

  it('derives the origin from the incoming request when nothing is configured', () => {
    const request = new Request('http://internal:3000/sitemap.xml', {
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
    })
    expect(resolveSiteUrl(undefined, { request })).toBe('https://example.com')
  })

  it('prefers the request host over env vars', () => {
    process.env.SITE_URL = 'https://canonical.example.com'
    const request = new Request('https://alias.vercel.app/sitemap.xml', {
      headers: { host: 'alias.vercel.app' },
    })
    expect(resolveSiteUrl(undefined, { request })).toBe('https://alias.vercel.app')
  })

  it('lets an explicit siteUrl option win over the request', () => {
    const request = new Request('https://alias.vercel.app/sitemap.xml', {
      headers: { host: 'alias.vercel.app' },
    })
    expect(resolveSiteUrl('https://canonical.example.com', { request })).toBe(
      'https://canonical.example.com',
    )
  })

  it("prefers the request host over Vercel's project alias", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'project.vercel.app'
    const request = new Request('https://project.vercel.app/sitemap.xml', {
      headers: {
        host: 'project.vercel.app',
        'x-forwarded-host': 'www.example.com',
        'x-forwarded-proto': 'https',
      },
    })
    expect(resolveSiteUrl(undefined, { request })).toBe('https://www.example.com')
  })

  it('gives a configured siteUrl function full control, passing the request through', () => {
    const request = new Request('https://tenant-a.example.com/sitemap.xml', {
      headers: { host: 'tenant-a.example.com' },
    })
    const fn = ({ request: incoming }: { request?: { url?: null | string } }) =>
      `https://mirror-of-${new URL(incoming!.url!).hostname}`
    expect(resolveSiteUrl(fn, { request })).toBe('https://mirror-of-tenant-a.example.com')
  })
})

describe('siteUrlFromRequest', () => {
  it('prefers forwarded headers over the host header', () => {
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'public.example.com',
      'x-forwarded-proto': 'https',
    })
    expect(siteUrlFromRequest({ request: { headers } })).toBe('https://public.example.com')
  })

  it('takes the first value of comma-separated forwarded headers', () => {
    const headers = new Headers({
      'x-forwarded-host': 'a.example.com, b.internal',
      'x-forwarded-proto': 'https, http',
    })
    expect(siteUrlFromRequest({ request: { headers } })).toBe('https://a.example.com')
  })

  it('defaults to https for public hosts and http for local ones', () => {
    expect(siteUrlFromRequest({ request: { headers: new Headers({ host: 'example.com' }) } })).toBe(
      'https://example.com',
    )
    expect(
      siteUrlFromRequest({ request: { headers: new Headers({ host: 'localhost:3000' }) } }),
    ).toBe('http://localhost:3000')
    expect(
      siteUrlFromRequest({ request: { headers: new Headers({ host: '127.0.0.1:3000' }) } }),
    ).toBe('http://127.0.0.1:3000')
  })

  it('falls back to the host header when forwarded headers are empty', () => {
    const headers = new Headers({
      host: 'example.com',
      'x-forwarded-host': '',
      'x-forwarded-proto': '',
    })
    expect(siteUrlFromRequest({ request: { headers } })).toBe('https://example.com')
  })

  it('falls back to the request URL origin when no host header is present', () => {
    expect(
      siteUrlFromRequest({
        request: { headers: new Headers(), url: 'https://from-url.example.com/x' },
      }),
    ).toBe('https://from-url.example.com')
  })

  it('returns undefined when the request carries nothing usable', () => {
    expect(siteUrlFromRequest({ request: { headers: new Headers() } })).toBeUndefined()
    expect(siteUrlFromRequest({})).toBeUndefined()
  })
})

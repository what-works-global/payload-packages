import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateRobotsTxt, getSitemapEntries, sitemapPlugin } from '../src/index.js'

let payload: Payload
let tmpDir: string

const findEndpoint = (endpointPath: string): Endpoint => {
  const endpoint = payload.config.endpoints.find(
    (candidate) => candidate.path === endpointPath && candidate.method === 'get',
  )
  if (!endpoint) {
    throw new Error(`Endpoint ${endpointPath} not registered`)
  }
  return endpoint
}

const fakeRequest = (
  overrides: Partial<Record<'routeParams' | 'user', unknown>> = {},
): PayloadRequest =>
  ({
    payload,
    routeParams: {},
    url: 'http://cms.local/api/sitemap/index.xml',
    user: null,
    ...overrides,
  }) as unknown as PayloadRequest

/** Polls until the sitemap reflects post-invalidation state (invalidation runs after the request). */
const waitForEntries = async (
  predicate: (entries: Record<string, { loc: string }[]>) => boolean,
): Promise<Record<string, { loc: string }[]>> => {
  const deadline = Date.now() + 5_000
  while (true) {
    const entries = await getSitemapEntries(payload)
    if (predicate(entries)) {
      return entries
    }
    if (Date.now() > deadline) {
      return entries
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-sitemap-test-'))

  const config = await buildConfig({
    collections: [
      {
        slug: 'pages',
        fields: [{ name: 'slug', type: 'text', required: true }],
        versions: { drafts: true },
      },
      {
        // No drafts — regression case: the `_status` filter must not be applied here.
        slug: 'legal',
        fields: [{ name: 'slug', type: 'text', required: true }],
      },
    ],
    db: sqliteAdapter({
      client: { url: `file:${path.join(tmpDir, 'test.db')}` },
      push: true,
    }),
    plugins: [
      sitemapPlugin({
        cache: 'memory',
        collections: {
          legal: {
            path: ({ doc }) => (doc.slug === 'skip' ? null : `/legal/${doc.slug}`),
            select: { slug: true },
          },
          pages: {
            path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`),
            select: { slug: true },
          },
        },
        endpoints: { json: true },
        routes: [{ path: '/search' }],
        siteUrl: 'https://example.com',
      }),
    ],
    secret: 'test-secret',
    telemetry: false,
  })

  payload = await getPayload({ config })

  await payload.create({
    collection: 'pages',
    data: { slug: 'home', _status: 'published' },
  })
  await payload.create({
    collection: 'pages',
    data: { slug: 'about', _status: 'published' },
  })
  await payload.create({
    collection: 'pages',
    data: { slug: 'draft-only', _status: 'draft' },
  })
  await payload.create({
    collection: 'pages',
    data: { slug: 'hidden', _status: 'published', excludeFromSitemap: true },
  })
  await payload.create({ collection: 'legal', data: { slug: 'privacy' } })
  await payload.create({ collection: 'legal', data: { slug: 'skip' } })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  fs.rmSync(tmpDir, { force: true, recursive: true })
})

describe('entry generation', () => {
  it('includes published docs with correct URLs and lastmod', async () => {
    const entries = await getSitemapEntries(payload)
    const pageLocs = entries.pages.map((entry) => entry.loc)

    expect(pageLocs).toContain('https://example.com/')
    expect(pageLocs).toContain('https://example.com/about')
    expect(entries.pages.every((entry) => entry.lastmod)).toBe(true)
    expect(new Date(entries.pages[0].lastmod!).getTime()).not.toBeNaN()
  })

  it('excludes drafts and excludeFromSitemap docs', async () => {
    const entries = await getSitemapEntries(payload)
    const pageLocs = entries.pages.map((entry) => entry.loc)

    expect(pageLocs).not.toContain('https://example.com/draft-only')
    expect(pageLocs).not.toContain('https://example.com/hidden')
  })

  it('handles collections without drafts (no _status query error)', async () => {
    const entries = await getSitemapEntries(payload)
    expect(entries.legal.map((entry) => entry.loc)).toEqual(['https://example.com/legal/privacy'])
  })

  it('omits docs whose path() returns null', async () => {
    const entries = await getSitemapEntries(payload)
    expect(entries.legal.some((entry) => entry.loc.includes('skip'))).toBe(false)
  })

  it('includes the extra routes group', async () => {
    const entries = await getSitemapEntries(payload)
    expect(entries._routes.map((entry) => entry.loc)).toEqual(['https://example.com/search'])
  })
})

describe('hook-driven invalidation', () => {
  it('reflects newly published docs after the cache invalidates', async () => {
    // Warm the cache first.
    await getSitemapEntries(payload)

    await payload.create({
      collection: 'pages',
      data: { slug: 'fresh', _status: 'published' },
    })

    const entries = await waitForEntries((current) =>
      current.pages.some((entry) => entry.loc === 'https://example.com/fresh'),
    )
    expect(entries.pages.map((entry) => entry.loc)).toContain('https://example.com/fresh')
  })

  it('does not invalidate for draft-only saves', async () => {
    await getSitemapEntries(payload)

    await payload.create({
      collection: 'pages',
      data: { slug: 'still-draft', _status: 'draft' },
    })
    // Give any (incorrect) invalidation a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 200))

    const entries = await getSitemapEntries(payload)
    expect(entries.pages.some((entry) => entry.loc.includes('still-draft'))).toBe(false)
  })

  it('removes deleted docs after invalidation', async () => {
    const created = await payload.create({
      collection: 'pages',
      data: { slug: 'doomed', _status: 'published' },
    })
    await waitForEntries((current) =>
      current.pages.some((entry) => entry.loc === 'https://example.com/doomed'),
    )

    await payload.delete({ id: created.id, collection: 'pages' })

    const entries = await waitForEntries(
      (current) => !current.pages.some((entry) => entry.loc === 'https://example.com/doomed'),
    )
    expect(entries.pages.map((entry) => entry.loc)).not.toContain('https://example.com/doomed')
  })
})

describe('REST endpoints', () => {
  it('serves a sitemap index referencing chunk files on the request origin', async () => {
    const response = await findEndpoint('/sitemap/index.xml').handler(fakeRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')

    const xml = await response.text()
    expect(xml).toContain('<sitemapindex')
    expect(xml).toContain('http://cms.local/api/sitemap/pages-1.xml')
    expect(xml).toContain('http://cms.local/api/sitemap/legal-1.xml')
    expect(xml).toContain('http://cms.local/api/sitemap/_routes-1.xml')
  })

  it('serves chunk files', async () => {
    const response = await findEndpoint('/sitemap/:file').handler(
      fakeRequest({ routeParams: { file: 'pages-1.xml' } }),
    )
    expect(response.status).toBe(200)
    const xml = await response.text()
    expect(xml).toContain('<urlset')
    expect(xml).toContain('<loc>https://example.com/about</loc>')
  })

  it('404s unknown chunk files', async () => {
    const response = await findEndpoint('/sitemap/:file').handler(
      fakeRequest({ routeParams: { file: 'unknown-1.xml' } }),
    )
    expect(response.status).toBe(404)
  })

  it('registers the :file catch-all after the static paths so it cannot shadow them', () => {
    const paths = payload.config.endpoints
      .filter((endpoint) => endpoint.path.startsWith('/sitemap/'))
      .map((endpoint) => endpoint.path)
    expect(paths.indexOf('/sitemap/:file')).toBeGreaterThan(paths.indexOf('/sitemap/index.xml'))
    expect(paths.indexOf('/sitemap/:file')).toBeGreaterThan(paths.indexOf('/sitemap/entries.json'))
  })

  it('guards the JSON endpoint behind authentication by default', async () => {
    const endpoint = findEndpoint('/sitemap/entries.json')

    const anonymous = await endpoint.handler(fakeRequest())
    expect(anonymous.status).toBe(403)

    const authenticated = await endpoint.handler(fakeRequest({ user: { id: 1 } }))
    expect(authenticated.status).toBe(200)
    const body = (await authenticated.json()) as { entries: Record<string, unknown[]> }
    expect(Object.keys(body.entries).sort()).toEqual(['_routes', 'legal', 'pages'])
  })
})

describe('robots.txt', () => {
  it('produces production output with sitemap reference and admin/API disallows', async () => {
    const txt = await generateRobotsTxt(payload.config, { isProduction: true })
    expect(txt).toContain('User-agent: *')
    expect(txt).toContain('Disallow: /admin/')
    expect(txt).toContain('Disallow: /api/')
    expect(txt).toContain('Sitemap: https://example.com/sitemap.xml')
  })

  it('disallows everything outside production', async () => {
    const txt = await generateRobotsTxt(payload.config, { isProduction: false })
    expect(txt).toContain('Disallow: /')
    expect(txt).not.toContain('Sitemap:')
  })
})

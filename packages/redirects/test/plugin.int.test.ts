import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RedirectsCache } from '../src/index.js'

import { memoryCache } from '../src/exports/cache.js'
import { redirectsPlugin, syncRedirectsCache } from '../src/index.js'

let payload: Payload
let cache: RedirectsCache
let tmpDir: string

const findEndpoint = (endpointPath: string): Endpoint => {
  const endpoint = payload.config.endpoints.find(
    (candidate) => candidate.path === endpointPath && candidate.method === 'post',
  )
  if (!endpoint) {
    throw new Error(`Endpoint ${endpointPath} not registered`)
  }
  return endpoint
}

const fakeRequest = (routeParams: Record<string, unknown> = {}): PayloadRequest =>
  ({
    payload,
    routeParams,
    url: 'http://cms.local/api/payload-redirects',
    user: null,
  }) as unknown as PayloadRequest

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-redirects-test-'))
  cache = memoryCache()

  const config = await buildConfig({
    collections: [
      {
        slug: 'pages',
        fields: [{ name: 'slug', type: 'text', required: true }],
        versions: { drafts: true },
      },
    ],
    db: sqliteAdapter({
      client: { url: `file:${path.join(tmpDir, 'test.db')}` },
      push: true,
    }),
    plugins: [
      redirectsPlugin({
        cache,
        collections: {
          pages: { path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`) },
        },
      }),
    ],
    secret: 'test-secret',
    telemetry: false,
  })

  payload = await getPayload({ config })
})

afterAll(async () => {
  if (typeof payload?.db?.destroy === 'function') {
    await payload.db.destroy()
  }
  fs.rmSync(tmpDir, { force: true, recursive: true })
})

describe('redirectsPlugin integration', () => {
  it('caches custom-URL redirects on create, normalized and with scrollTo applied', async () => {
    const redirect = await payload.create({
      collection: 'redirects' as never,
      data: {
        type: '301',
        from: 'https://example.com/legacy/',
        to: { type: 'custom', scrollTo: '#signup', url: '/landing' },
      } as never,
    })

    expect(await cache.get()).toEqual([
      {
        id: String((redirect as { id: number | string }).id),
        type: '301',
        from: '/legacy',
        to: '/landing#signup',
      },
    ])
  })

  it('resolves reference redirects and follows published path changes', async () => {
    const page = (await payload.create({
      collection: 'pages' as never,
      data: { slug: 'about', _status: 'published' } as never,
    })) as { id: number | string }

    await payload.create({
      collection: 'redirects' as never,
      data: {
        type: '302',
        from: '/old-about',
        to: {
          type: 'reference',
          reference: { relationTo: 'pages', value: page.id },
          scrollTo: 'team',
        },
      } as never,
    })

    const cached = await cache.get()
    expect(cached?.find((entry) => entry.from === '/old-about')?.to).toBe('/about#team')

    // A published slug change re-syncs the cache through the pages hook.
    await payload.update({
      id: page.id,
      collection: 'pages' as never,
      data: { slug: 'about-us', _status: 'published' } as never,
    })
    expect((await cache.get())?.find((entry) => entry.from === '/old-about')?.to).toBe(
      '/about-us#team',
    )

    // A draft save must not leak into the cache.
    await payload.update({
      id: page.id,
      collection: 'pages' as never,
      data: { slug: 'sneaky-draft' } as never,
      draft: true,
    })
    expect((await cache.get())?.find((entry) => entry.from === '/old-about')?.to).toBe(
      '/about-us#team',
    )

    // Publishing the draft makes the move visible.
    await payload.update({
      id: page.id,
      collection: 'pages' as never,
      data: { _status: 'published' } as never,
    })
    expect((await cache.get())?.find((entry) => entry.from === '/old-about')?.to).toBe(
      '/sneaky-draft#team',
    )

    // Deleting the destination drops the redirect from the cache entirely.
    await payload.delete({ id: page.id, collection: 'pages' as never })
    expect((await cache.get())?.some((entry) => entry.from === '/old-about')).toBe(false)
  })

  it('updates and removes cache entries as redirects change', async () => {
    const redirect = (await payload.create({
      collection: 'redirects' as never,
      data: {
        type: '301',
        from: '/temp',
        to: { type: 'custom', url: '/here' },
      } as never,
    })) as { id: number | string }

    await payload.update({
      id: redirect.id,
      collection: 'redirects' as never,
      data: { to: { type: 'custom', url: '/there' } } as never,
    })
    expect((await cache.get())?.find((entry) => entry.from === '/temp')?.to).toBe('/there')

    await payload.delete({ id: redirect.id, collection: 'redirects' as never })
    expect((await cache.get())?.some((entry) => entry.from === '/temp')).toBe(false)
  })

  it('increments hits through the hit endpoint without rebuilding the cache', async () => {
    const redirect = (await payload.create({
      collection: 'redirects' as never,
      data: {
        type: '301',
        from: '/counted',
        to: { type: 'custom', url: '/target' },
      } as never,
    })) as { hits: number; id: number | string }
    expect(redirect.hits).toBe(0)

    const handler = findEndpoint('/payload-redirects/hit/:id').handler
    const response = await handler(fakeRequest({ id: String(redirect.id) }))
    expect(response.status).toBe(200)

    const updated = (await payload.findByID({
      id: redirect.id,
      collection: 'redirects' as never,
    })) as unknown as { hits: number; lastAccess?: string }
    expect(updated.hits).toBe(1)
    expect(updated.lastAccess).toBeTruthy()

    expect((await handler(fakeRequest({ id: '999999' }))).status).toBe(404)
    expect((await handler(fakeRequest())).status).toBe(400)
  })

  it('rebuilds the cache via the refresh endpoint and syncRedirectsCache', async () => {
    await cache.set([])
    expect(await cache.get()).toEqual([])

    const handler = findEndpoint('/payload-redirects/refresh-cache').handler
    const response = await handler(fakeRequest())
    expect(response.status).toBe(200)
    expect((await cache.get())?.length).toBeGreaterThan(0)

    await cache.set([])
    await syncRedirectsCache(payload)
    expect((await cache.get())?.length).toBeGreaterThan(0)
  })
})

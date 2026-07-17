import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RedirectsCache, RedirectsPluginConfig } from '../src/index.js'

import { memoryCache } from '../src/exports/cache.js'
import { migrateFromOfficialRedirects, redirectsPlugin, syncRedirectsCache } from '../src/index.js'

type TestInstance = {
  cache: RedirectsCache
  destroy: () => Promise<void>
  payload: Payload
}

const findEndpointOn = (payload: Payload, endpointPath: string): Endpoint => {
  const endpoint = payload.config.endpoints.find(
    (candidate) => candidate.path === endpointPath && candidate.method === 'post',
  )
  if (!endpoint) {
    throw new Error(`Endpoint ${endpointPath} not registered`)
  }
  return endpoint
}

const fakeRequest = (
  payload: Payload,
  {
    headers,
    routeParams = {},
    user = null,
  }: {
    headers?: Record<string, string>
    routeParams?: Record<string, unknown>
    user?: unknown
  } = {},
): PayloadRequest =>
  ({
    headers: new Headers(headers ?? {}),
    payload,
    routeParams,
    url: 'http://cms.local/api/payload-redirects',
    user,
  }) as unknown as PayloadRequest

const buildInstance = async (
  pluginOverrides: Partial<RedirectsPluginConfig> = {},
  configOverrides: Record<string, unknown> = {},
  options: { dbFile?: string } = {},
): Promise<TestInstance> => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-redirects-test-'))
  const cache = memoryCache()
  // A shared `dbFile` lets two instances (with independent caches) point at the
  // same sqlite file — the setup the syncOnInit test needs.
  const dbFile = options.dbFile ?? path.join(tmpDir, 'test.db')

  const config = await buildConfig({
    collections: [
      {
        slug: 'pages',
        fields: [{ name: 'slug', type: 'text', required: true }],
        versions: { drafts: true },
      },
    ],
    db: sqliteAdapter({
      client: { url: `file:${dbFile}` },
      push: true,
    }),
    plugins: [
      redirectsPlugin({
        cache,
        collections: {
          pages: { path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`) },
        },
        ...pluginOverrides,
      }),
    ],
    secret: 'test-secret',
    telemetry: false,
    // getPayload auto-spawns a `payload generate:types` child process per
    // instance outside production; those workers outlive vitest as PPID=1
    // CPU-spinning zombies. Types are irrelevant to these tests.
    typescript: { autoGenerate: false },
    ...configOverrides,
  })

  // A unique key per instance so getPayload does not return a globally-cached
  // instance built from a different config (secret / localization differ).
  const payload = await getPayload({ config, key: tmpDir })

  return {
    cache,
    destroy: async () => {
      if (typeof payload?.db?.destroy === 'function') {
        await payload.db.destroy()
      }
      fs.rmSync(tmpDir, { force: true, recursive: true })
    },
    payload,
  }
}

// All instances are built up front and torn down together. Building one sqlite
// instance and destroying it before another is built leaves the second without
// its pushed schema ("no such table") — so they must coexist for the run.
let mainInstance: TestInstance
let secretInstance: TestInstance
let localizedInstance: TestInstance
let migrationInstance: TestInstance

beforeAll(async () => {
  // db-sqlite's dev schema push caches the last-pushed schema at module scope
  // and skips the push when a later instance has an identical schema — leaving
  // that instance's fresh db without tables. Force every instance to push.
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

  mainInstance = await buildInstance()
  secretInstance = await buildInstance({ secret: 'topsecret' })
  localizedInstance = await buildInstance(
    { localized: true },
    {
      localization: {
        defaultLocale: 'en',
        fallback: false,
        locales: ['en', 'fr'],
      },
    },
  )
  migrationInstance = await buildInstance()
})

afterAll(async () => {
  await mainInstance?.destroy()
  await secretInstance?.destroy()
  await localizedInstance?.destroy()
  await migrationInstance?.destroy()
})

describe('redirectsPlugin integration', () => {
  let payload: Payload
  let cache: RedirectsCache

  beforeAll(() => {
    payload = mainInstance.payload
    cache = mainInstance.cache
  })

  it('caches custom-URL redirects on create, normalized and with scrollTo applied', async () => {
    const redirect = await payload.create({
      collection: 'redirects' as never,
      data: {
        from: 'https://example.com/legacy/',
        status: '301',
        to: { type: 'custom', scrollTo: '#signup', url: '/landing' },
      } as never,
    })

    expect(await cache.get()).toEqual([
      {
        id: String((redirect as { id: number | string }).id),
        from: '/legacy',
        status: 301,
        to: '/landing#signup',
      },
    ])
  })

  it('caches custom-URL redirects with queryParams applied', async () => {
    await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/promo',
        status: '301',
        to: {
          type: 'custom',
          queryParams: [
            { key: 'utm_source', value: 'nl' },
            { key: 'utm_medium', value: 'email' },
          ],
          url: '/sale',
        },
      } as never,
    })

    const cached = await cache.get()
    expect(cached?.find((entry) => entry.from === '/promo')?.to).toBe(
      '/sale?utm_source=nl&utm_medium=email',
    )
  })

  it('resolves reference redirects and follows published path changes', async () => {
    const page = (await payload.create({
      collection: 'pages' as never,
      data: { slug: 'about', _status: 'published' } as never,
    })) as { id: number | string }

    await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/old-about',
        status: '302',
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

  it('caches match/caseInsensitive/forwardQuery flags and excludes disabled redirects', async () => {
    await payload.create({
      collection: 'redirects' as never,
      data: {
        caseInsensitive: true,
        forwardQuery: true,
        from: '/Section/',
        matchType: 'startsWith',
        status: '301',
        to: { type: 'custom', url: '/new-section' },
      } as never,
    })
    const disabled = (await payload.create({
      collection: 'redirects' as never,
      data: {
        enabled: false,
        from: '/disabled',
        status: '301',
        to: { type: 'custom', url: '/nope' },
      } as never,
    })) as { id: number | string }

    const cached = await cache.get()
    const entry = cached?.find((candidate) => candidate.from === '/Section/')
    expect(entry).toMatchObject({
      caseInsensitive: true,
      forwardQuery: true,
      from: '/Section/',
      match: 'startsWith',
      to: '/new-section',
    })
    expect(cached?.some((candidate) => candidate.id === String(disabled.id))).toBe(false)
  })

  it('rejects redirect loops and self-redirects at save time', async () => {
    await payload.create({
      collection: 'redirects' as never,
      data: { from: '/loop-a', status: '301', to: { type: 'custom', url: '/loop-b' } } as never,
    })

    await expect(
      payload.create({
        collection: 'redirects' as never,
        data: { from: '/loop-b', status: '301', to: { type: 'custom', url: '/loop-a' } } as never,
      }),
    ).rejects.toThrow()

    await expect(
      payload.create({
        collection: 'redirects' as never,
        data: { from: '/self', status: '301', to: { type: 'custom', url: '/self' } } as never,
      }),
    ).rejects.toThrow()
  })

  it('increments hits atomically under concurrent hit requests', async () => {
    const redirect = (await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/counted-concurrent',
        status: '301',
        to: { type: 'custom', url: '/target' },
      } as never,
    })) as { hits: number; id: number | string }
    expect(redirect.hits).toBe(0)

    const handler = findEndpointOn(payload, '/payload-redirects/hit/:id').handler
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        handler(fakeRequest(payload, { routeParams: { id: String(redirect.id) } })),
      ),
    )
    expect(responses.every((response) => response.status === 200)).toBe(true)

    const updated = (await payload.findByID({
      id: redirect.id,
      collection: 'redirects' as never,
    })) as unknown as { hits: number }
    expect(updated.hits).toBe(10)
  })

  it('increments hits through the hit endpoint without rebuilding the cache', async () => {
    const redirect = (await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/counted',
        status: '301',
        to: { type: 'custom', url: '/target' },
      } as never,
    })) as { hits: number; id: number | string }
    expect(redirect.hits).toBe(0)

    const handler = findEndpointOn(payload, '/payload-redirects/hit/:id').handler
    const response = await handler(
      fakeRequest(payload, { routeParams: { id: String(redirect.id) } }),
    )
    expect(response.status).toBe(200)

    const updated = (await payload.findByID({
      id: redirect.id,
      collection: 'redirects' as never,
    })) as unknown as { hits: number; lastAccess?: string }
    expect(updated.hits).toBe(1)
    expect(updated.lastAccess).toBeTruthy()

    expect((await handler(fakeRequest(payload, { routeParams: { id: '999999' } }))).status).toBe(
      404,
    )
    expect((await handler(fakeRequest(payload))).status).toBe(400)
  })

  it('rebuilds the cache via the refresh endpoint and syncRedirectsCache', async () => {
    await cache.set([])
    expect(await cache.get()).toEqual([])

    const handler = findEndpointOn(payload, '/payload-redirects/refresh-cache').handler
    const response = await handler(fakeRequest(payload))
    expect(response.status).toBe(200)
    expect((await cache.get())?.length).toBeGreaterThan(0)

    await cache.set([])
    await syncRedirectsCache(payload)
    expect((await cache.get())?.length).toBeGreaterThan(0)
  })
})

describe('redirectsPlugin secret hardening', () => {
  let payload: Payload

  beforeAll(() => {
    payload = secretInstance.payload
  })

  it('rejects endpoint calls without the secret or a user, and allows them with either', async () => {
    const refresh = findEndpointOn(payload, '/payload-redirects/refresh-cache').handler
    const hit = findEndpointOn(payload, '/payload-redirects/hit/:id').handler

    // No secret, no user → 403.
    expect((await refresh(fakeRequest(payload))).status).toBe(403)
    expect((await hit(fakeRequest(payload, { routeParams: { id: '1' } }))).status).toBe(403)

    // Wrong secret → 403.
    expect(
      (await refresh(fakeRequest(payload, { headers: { 'x-payload-redirects-secret': 'nope' } })))
        .status,
    ).toBe(403)

    // Correct secret header → authorized (200 for refresh).
    expect(
      (
        await refresh(
          fakeRequest(payload, { headers: { 'x-payload-redirects-secret': 'topsecret' } }),
        )
      ).status,
    ).toBe(200)

    // Authenticated user → authorized (400 here only because no id is supplied).
    expect((await hit(fakeRequest(payload, { user: { id: 1 } }))).status).toBe(400)
  })
})

describe('redirectsPlugin localization', () => {
  let payload: Payload
  let cache: RedirectsCache

  beforeAll(() => {
    payload = localizedInstance.payload
    cache = localizedInstance.cache
  })

  it('builds a per-locale cache and skips locales with no `from`', async () => {
    const doc = (await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/en-old',
        status: '301',
        to: { type: 'custom', url: '/en-new' },
      } as never,
      locale: 'en',
    })) as { id: number | string }

    await payload.update({
      id: doc.id,
      collection: 'redirects' as never,
      data: { from: '/fr-old', to: { type: 'custom', url: '/fr-new' } } as never,
      locale: 'fr',
    })

    // A second redirect only ever set in English — must NOT appear in the fr cache.
    await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/en-only',
        status: '301',
        to: { type: 'custom', url: '/en-only-new' },
      } as never,
      locale: 'en',
    })

    await syncRedirectsCache(payload)
    const cached = await cache.get()

    const en = cached?.filter((entry) => entry.locale === 'en') ?? []
    const fr = cached?.filter((entry) => entry.locale === 'fr') ?? []

    expect(en.map((entry) => entry.from).sort()).toEqual(['/en-old', '/en-only'])
    expect(en.find((entry) => entry.from === '/en-old')?.to).toBe('/en-new')

    expect(fr.map((entry) => entry.from)).toEqual(['/fr-old'])
    expect(fr[0]?.to).toBe('/fr-new')
  })
})

describe('migrateFromOfficialRedirects', () => {
  let payload: Payload
  let cache: RedirectsCache

  beforeAll(() => {
    payload = migrationInstance.payload
    cache = migrationInstance.cache
  })

  it('backfills official-plugin rows, normalizes `from`, and rebuilds the cache', async () => {
    // Insert an official-shaped row straight through the db adapter, bypassing
    // this plugin's field defaults, `from` normalization, and cache-sync hooks —
    // exactly the state left behind by `@payloadcms/plugin-redirects`.
    const created = (await payload.db.create({
      collection: 'redirects' as never,
      data: {
        // Explicit nulls override the column defaults so the row genuinely
        // lacks this plugin's fields, like a real `@payloadcms/plugin-redirects`
        // document. `from` carries a trailing slash the official plugin never
        // normalized.
        enabled: null,
        from: '/legacy-path/',
        matchType: null,
        status: null,
        to: { type: 'custom', url: '/new-path' },
      },
    })) as { id: number | string }
    const id = String(created.id)

    // The raw row never reached the cache (still a miss on a fresh instance).
    expect((await cache.get())?.some((entry) => entry.id === id) ?? false).toBe(false)

    const result = await migrateFromOfficialRedirects({ payload })
    expect(result.errors).toEqual([])
    expect(result.updated).toBeGreaterThanOrEqual(1)

    const migrated = (await payload.findByID({
      id: created.id,
      collection: 'redirects' as never,
    })) as unknown as { enabled: boolean; from: string; matchType: string; status: string }
    expect(migrated.status).toBe('301')
    expect(migrated.matchType).toBe('exact')
    expect(migrated.enabled).toBe(true)
    // Re-saving ran the `from` normalization hook (trailing slash stripped).
    expect(migrated.from).toBe('/legacy-path')

    const cached = await cache.get()
    expect(cached?.find((entry) => entry.id === id)).toMatchObject({
      from: '/legacy-path',
      status: 301,
      to: '/new-path',
    })

    // Idempotent: a complete row is skipped on a second run.
    const second = await migrateFromOfficialRedirects({ payload })
    expect(second.updated).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(1)
  })
})

describe('redirectsPlugin syncOnInit', () => {
  it('rebuilds a fresh instance cache from the db on init, and honours syncOnInit: false', async () => {
    // Two instances, run one at a time, point at the same sqlite file. Because
    // the writer creates the schema on disk, a later instance reopening the file
    // has its tables regardless of push — so these need not coexist.
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-redirects-syncinit-'))
    const dbFile = path.join(sharedDir, 'shared.db')

    try {
      // 1. The writer seeds the shared database; its own change hook fills its cache.
      const writer = await buildInstance({}, {}, { dbFile })
      await writer.payload.create({
        collection: 'redirects' as never,
        data: {
          from: '/sync-init',
          status: '301',
          to: { type: 'custom', url: '/synced' },
        } as never,
      })
      expect((await writer.cache.get())?.some((entry) => entry.from === '/sync-init')).toBe(true)
      await writer.destroy()

      // 2. A fresh instance on the same db, with its own empty cache, backfills it
      //    on init — no request, no content change needed.
      const reader = await buildInstance({}, {}, { dbFile })
      expect((await reader.cache.get())?.some((entry) => entry.from === '/sync-init')).toBe(true)
      await reader.destroy()

      // 3. With syncOnInit: false the cache stays a miss after boot.
      const disabledReader = await buildInstance({ syncOnInit: false }, {}, { dbFile })
      expect(await disabledReader.cache.get()).toBeNull()
      await disabledReader.destroy()
    } finally {
      fs.rmSync(sharedDir, { force: true, recursive: true })
    }
  })
})

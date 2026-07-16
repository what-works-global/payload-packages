import type { CollectionSlug, Endpoint, PayloadRequest, TypeWithID } from 'payload'

import type { ResolvedRedirectsConfig } from '../types.js'

import { syncRedirectsCache } from '../core/build.js'

const SECRET_HEADER = 'x-payload-redirects-secret'

/**
 * When a `secret` is configured, both endpoints require either the shared
 * secret header or an authenticated user. Unset → open (zero-config).
 */
const isAuthorized = (req: PayloadRequest, config: ResolvedRedirectsConfig): boolean => {
  if (!config.secret) {
    return true
  }
  if (req.user) {
    return true
  }
  return req.headers?.get(SECRET_HEADER) === config.secret
}

const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 })

type HitDoc = { hits?: number } & TypeWithID

/**
 * Per-process serialization of hit writes, keyed by collection+id. The CAS
 * below is a true conditional update only on adapters whose `updateOne`
 * applies the `where` to the UPDATE itself (mongoose `findOneAndUpdate`). The
 * drizzle adapter resolves the id via `where` and then updates by that id, so
 * concurrent writes within one process can lose increments (verified against
 * v3.84.1). Serializing same-id writes in-process closes that window; the CAS
 * still guards against races across separate serverless instances on mongoose.
 */
const hitChains = new Map<string, Promise<unknown>>()

const runSerialized = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const prior = hitChains.get(key) ?? Promise.resolve()
  const result = prior.then(
    () => task(),
    () => task(),
  )
  const tail = result.then(
    () => {},
    () => {},
  )
  hitChains.set(key, tail)
  void tail.finally(() => {
    if (hitChains.get(key) === tail) {
      hitChains.delete(key)
    }
  })
  return result
}

const readHitDoc = (req: PayloadRequest, config: ResolvedRedirectsConfig, id: string) =>
  req.payload.db.findOne<HitDoc>({
    // The assertion only matters in consumer projects, where generated types
    // narrow CollectionSlug from string to a union of known slugs.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    collection: config.slug as CollectionSlug,
    req,
    where: { id: { equals: id } },
  })

const createHitEndpoint = (config: ResolvedRedirectsConfig): Endpoint => ({
  handler: async (req) => {
    if (!isAuthorized(req, config)) {
      return forbidden()
    }

    const id = typeof req.routeParams?.id === 'string' ? req.routeParams.id : undefined

    if (!id) {
      return Response.json({ error: 'Missing redirect id' }, { status: 400 })
    }

    const payload = req.payload
    const now = new Date().toISOString()

    return runSerialized(`${config.slug}:${id}`, async () => {
      // Optimistic concurrency: guard the write on the value we read. Both
      // adapters return `null` from `updateOne` when the `where` matches
      // nothing (verified against v3.84.1). Passing only `where` — never
      // `id` — is required, since both adapters ignore `where` when an `id`
      // is present. Retry on a lost race, then fall back to a best-effort
      // unguarded write.
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await readHitDoc(req, config, id)
        if (!existing) {
          return Response.json({ error: 'Redirect not found' }, { status: 404 })
        }

        const current = existing.hits ?? 0
        const updated = await payload.db.updateOne({
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          collection: config.slug as CollectionSlug,
          data: { hits: current + 1, lastAccess: now },
          req,
          where: {
            and: [{ id: { equals: existing.id } }, { hits: { equals: current } }],
          },
        })

        if (updated) {
          return Response.json({ ok: true })
        }
      }

      const existing = await readHitDoc(req, config, id)
      if (!existing) {
        return Response.json({ error: 'Redirect not found' }, { status: 404 })
      }

      await payload.db.updateOne({
        id: existing.id,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        collection: config.slug as CollectionSlug,
        data: { hits: (existing.hits ?? 0) + 1, lastAccess: now },
        req,
      })

      return Response.json({ ok: true })
    })
  },
  method: 'post',
  path: `${config.endpointsPath}/hit/:id`,
})

const createRefreshCacheEndpoint = (config: ResolvedRedirectsConfig): Endpoint => ({
  handler: async (req) => {
    if (!isAuthorized(req, config)) {
      return forbidden()
    }
    await syncRedirectsCache(req.payload, req)
    return Response.json({ ok: true })
  },
  method: 'post',
  path: `${config.endpointsPath}/refresh-cache`,
})

export const createRedirectsEndpoints = (config: ResolvedRedirectsConfig): Endpoint[] => [
  createRefreshCacheEndpoint(config),
  ...(config.trackHits ? [createHitEndpoint(config)] : []),
]

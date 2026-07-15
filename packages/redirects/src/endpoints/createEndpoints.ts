import type { CollectionSlug, Endpoint, TypeWithID } from 'payload'

import type { ResolvedRedirectsConfig } from '../types.js'

import { syncRedirectsCache } from '../core/build.js'

const createHitEndpoint = (config: ResolvedRedirectsConfig): Endpoint => ({
  handler: async (req) => {
    const id = typeof req.routeParams?.id === 'string' ? req.routeParams.id : undefined

    if (!id) {
      return Response.json({ error: 'Missing redirect id' }, { status: 400 })
    }

    const payload = req.payload
    const now = new Date()

    // Read-then-write via the adapter-level db API (DB-agnostic, and bypasses
    // collection hooks so a hit does not trigger a full redirect-cache rebuild).
    // NOTE: not atomic; concurrent hits can under-count. Fine for hit analytics.
    const existing = await payload.db.findOne<{ hits?: number } & TypeWithID>({
      // The assertion only matters in consumer projects, where generated types
      // narrow CollectionSlug from string to a union of known slugs.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      collection: config.slug as CollectionSlug,
      req,
      where: { id: { equals: id } },
    })

    if (!existing) {
      return Response.json({ error: 'Redirect not found' }, { status: 404 })
    }

    await payload.db.updateOne({
      id: existing.id,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      collection: config.slug as CollectionSlug,
      data: {
        hits: (existing.hits ?? 0) + 1,
        lastAccess: now.toISOString(),
      },
      req,
    })

    return Response.json({ ok: true })
  },
  method: 'post',
  path: `${config.endpointsPath}/hit/:id`,
})

const createRefreshCacheEndpoint = (config: ResolvedRedirectsConfig): Endpoint => ({
  handler: async (req) => {
    await syncRedirectsCache(req.payload, req)
    return Response.json({ ok: true })
  },
  method: 'post',
  path: `${config.endpointsPath}/refresh-cache`,
})

export const createRedirectsEndpoints = (config: ResolvedRedirectsConfig): Endpoint[] => [
  createRefreshCacheEndpoint(config),
  ...(config.hits ? [createHitEndpoint(config)] : []),
]

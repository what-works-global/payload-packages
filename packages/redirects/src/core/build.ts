import type { CollectionSlug, JsonObject, Payload, PayloadRequest } from 'payload'

import type { ResolvedRedirectsConfig } from '../types.js'
import type { CachedRedirect } from './shared.js'

import { getRedirectsConfig } from './resolved.js'
import { applyScrollTo, normalizeRedirectFrom } from './shared.js'

type RedirectDoc = {
  from?: unknown
  id: number | string
  to?: {
    reference?: { relationTo?: unknown; value?: unknown } | null
    scrollTo?: unknown
    type?: unknown
    url?: unknown
  } | null
  type?: unknown
  useRegex?: unknown
} & JsonObject

const resolveDestination = ({
  config,
  doc,
  req,
}: {
  config: ResolvedRedirectsConfig
  doc: RedirectDoc
  req?: PayloadRequest
}): null | string => {
  const to = doc.to
  if (!to || typeof to !== 'object') {
    return null
  }

  // `type` is only stored when internal destinations are configured; without
  // them the collection has no radio and every redirect is a custom URL.
  if (to.type === 'custom' || to.type == null) {
    return typeof to.url === 'string' && to.url.trim() !== '' ? to.url.trim() : null
  }

  if (to.type !== 'reference') {
    return null
  }

  const relationTo = to.reference?.relationTo
  const value = to.reference?.value
  if (typeof relationTo !== 'string' || !value || typeof value !== 'object') {
    return null
  }

  const target = config.collections[relationTo]
  if (!target) {
    return null
  }

  try {
    return target.path({ doc: value as JsonObject, req }) ?? null
  } catch {
    return null
  }
}

/**
 * Loads every redirect (in admin drag order) and denormalizes it into the
 * shape the middleware consumes. Rows that cannot produce a working redirect
 * — unresolvable references, empty destinations, unparseable `from` values —
 * are dropped rather than cached broken.
 */
export const buildRedirectsCacheEntries = async ({
  config,
  payload,
  req,
}: {
  config: ResolvedRedirectsConfig
  payload: Payload
  req?: PayloadRequest
}): Promise<CachedRedirect[]> => {
  const result = await payload.find({
    // The assertion only matters in consumer projects, where generated types
    // narrow CollectionSlug from string to a union of known slugs.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    collection: config.slug as CollectionSlug,
    depth: 1,
    pagination: false,
    req,
    sort: '_order',
  })

  return (result.docs as RedirectDoc[]).flatMap((doc): CachedRedirect[] => {
    if (doc.type !== '301' && doc.type !== '302') {
      return []
    }

    if (typeof doc.from !== 'string' || doc.from.trim() === '') {
      return []
    }

    const destination = resolveDestination({ config, doc, req })
    if (!destination) {
      return []
    }

    const useRegex = doc.useRegex === true
    let from = doc.from.trim()
    if (!useRegex) {
      try {
        from = normalizeRedirectFrom(from)
      } catch {
        return []
      }
    }

    return [
      {
        id: String(doc.id),
        type: doc.type,
        from,
        to: applyScrollTo(destination, doc.to?.scrollTo),
        ...(useRegex ? { regex: true } : {}),
      },
    ]
  })
}

/**
 * Rebuilds the redirects cache from the database. The plugin calls this from
 * its hooks and the refresh endpoint; call it yourself after seeding
 * redirects programmatically. Pass `req` when running inside a Payload
 * request so the rebuild sees uncommitted transaction state.
 */
export const syncRedirectsCache = async (payload: Payload, req?: PayloadRequest): Promise<void> => {
  const config = getRedirectsConfig(payload.config)
  const entries = await buildRedirectsCacheEntries({ config, payload, req })
  await config.cache.set(entries)
}

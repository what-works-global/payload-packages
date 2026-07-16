import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeChangeHook,
  CollectionSlug,
  JsonObject,
  PayloadRequest,
} from 'payload'

import { ValidationError } from 'payload'

import type { InternalRedirectsCollectionConfig } from '../types.js'

import { localizedFindArgs, syncRedirectsCache } from './build.js'
import { getRedirectsConfig } from './resolved.js'
import { normalizeRedirectFrom } from './shared.js'

/**
 * Hooks for the redirects collection itself: every change rewrites the cache.
 * Failures propagate — a redirect the editor believes is live but never
 * reached the cache is worse than a failed save.
 */
export const createRedirectsAfterChangeHook =
  (): CollectionAfterChangeHook =>
  async ({ req }) => {
    await syncRedirectsCache(req.payload, req)
  }

export const createRedirectsAfterDeleteHook =
  (): CollectionAfterDeleteHook =>
  async ({ req }) => {
    await syncRedirectsCache(req.payload, req)
  }

/** Canonical relative destination of a custom-URL redirect, or `null`. */
const customRelativeDestination = (
  to: { type?: unknown; url?: unknown } | null | undefined,
): null | string => {
  if (!to || typeof to !== 'object') {
    return null
  }
  if (!(to.type === 'custom' || to.type == null)) {
    return null
  }
  if (typeof to.url !== 'string') {
    return null
  }
  const trimmed = to.url.trim()
  if (trimmed === '' || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return null
  }
  try {
    // normalizeRedirectFrom canonicalizes and drops any fragment.
    const canonical = normalizeRedirectFrom(trimmed)
    return canonical.startsWith('/') ? canonical : null
  } catch {
    return null
  }
}

/**
 * Save-time loop prevention for the redirects collection. Scoped to candidates
 * that use `matchType: 'exact'` with a custom relative-URL destination: it
 * walks the graph of existing enabled exact redirects (plus the candidate) and
 * throws a `ValidationError` if following the candidate's destination leads
 * back to its own `from` within 20 hops (or directly, a self-redirect).
 * Reference destinations and non-exact match types are out of scope.
 */
export const createRedirectsBeforeChangeHook =
  (): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req }) => {
    const matchType =
      (data as { matchType?: unknown })?.matchType ??
      (originalDoc as { matchType?: unknown })?.matchType ??
      'exact'
    if (matchType !== 'exact') {
      return data
    }

    const destination = customRelativeDestination((data as { to?: unknown })?.to as never)
    if (!destination) {
      return data
    }

    const rawFrom = (data as { from?: unknown })?.from
    if (typeof rawFrom !== 'string') {
      return data
    }

    let candidateFrom: string
    try {
      candidateFrom = normalizeRedirectFrom(rawFrom)
    } catch {
      return data
    }

    const config = getRedirectsConfig(req.payload.config)

    const fail = (chain: string[]): never => {
      throw new ValidationError(
        {
          collection: config.slug,
          errors: [
            {
              message:
                chain.length <= 2
                  ? `This redirect points to itself (${candidateFrom}).`
                  : `This redirect would create a loop: ${chain.join(' → ')}.`,
              path: 'to.url',
            },
          ],
        },
        req.t,
      )
    }

    if (destination === candidateFrom) {
      fail([candidateFrom, destination])
    }

    const existing = await req.payload.find({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      collection: config.slug as CollectionSlug,
      depth: 0,
      ...localizedFindArgs(config.localized && req.locale ? req.locale : undefined),
      pagination: false,
      req,
      select: { enabled: true, from: true, matchType: true, to: true },
      where: {
        and: [{ matchType: { equals: 'exact' } }, { enabled: { not_equals: false } }],
      },
    })

    const graph = new Map<string, string>()
    for (const doc of existing.docs as JsonObject[]) {
      if (originalDoc && doc.id === (originalDoc as { id?: unknown }).id) {
        continue // the candidate's new values override the stored row
      }
      const docDestination = customRelativeDestination(doc.to as never)
      if (!docDestination) {
        continue
      }
      try {
        graph.set(normalizeRedirectFrom(String(doc.from)), docDestination)
      } catch {
        continue
      }
    }
    graph.set(candidateFrom, destination)

    const chain = [candidateFrom, destination]
    let cursor = destination
    for (let hop = 0; hop < 20; hop++) {
      const nextTo = graph.get(cursor)
      if (nextTo === undefined) {
        break
      }
      if (nextTo === candidateFrom) {
        chain.push(nextTo)
        fail(chain)
      }
      if (chain.includes(nextTo)) {
        break // a pre-existing cycle that doesn't involve the candidate
      }
      chain.push(nextTo)
      cursor = nextTo
    }

    return data
  }

const safePath = (
  target: InternalRedirectsCollectionConfig,
  doc: JsonObject | undefined,
  req: PayloadRequest,
): null | string => {
  if (!doc) {
    return null
  }
  try {
    return target.path({ doc, locale: req.locale ?? undefined, req }) ?? null
  } catch {
    return null
  }
}

const resync = async (req: PayloadRequest, slug: string) => {
  try {
    await syncRedirectsCache(req.payload, req)
  } catch (error) {
    req.payload.logger.error(
      error,
      `[payload-redirects] Failed to re-sync the redirects cache after a "${slug}" change`,
    )
  }
}

/**
 * Hooks for collections referenced as redirect destinations: cached
 * destinations are resolved paths, so when a published doc moves the cache
 * must be rebuilt. Draft saves and path-preserving updates are skipped; when
 * the previous doc was a draft the old published path is unknowable from hook
 * args alone, so the rebuild runs to stay correct. Unlike the redirects
 * collection's own hooks, failures only log — a broken cache backend must not
 * block content publishing.
 */
export const createTargetAfterChangeHook =
  (slug: string): CollectionAfterChangeHook =>
  async ({ doc, operation, previousDoc, req }) => {
    if (operation !== 'update') {
      // A freshly created doc cannot be referenced by an existing redirect.
      return
    }
    if (doc?._status === 'draft') {
      return
    }

    const target = getRedirectsConfig(req.payload.config).collections[slug]
    if (!target) {
      return
    }

    if (
      previousDoc &&
      previousDoc._status !== 'draft' &&
      safePath(target, doc, req) === safePath(target, previousDoc, req)
    ) {
      return
    }

    await resync(req, slug)
  }

export const createTargetAfterDeleteHook =
  (slug: string): CollectionAfterDeleteHook =>
  async ({ req }) => {
    await resync(req, slug)
  }

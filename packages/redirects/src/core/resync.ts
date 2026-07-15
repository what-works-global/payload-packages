import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  JsonObject,
  PayloadRequest,
} from 'payload'

import type { InternalRedirectsCollectionConfig } from '../types.js'

import { syncRedirectsCache } from './build.js'
import { getRedirectsConfig } from './resolved.js'

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

const safePath = (
  target: InternalRedirectsCollectionConfig,
  doc: JsonObject | undefined,
  req: PayloadRequest,
): null | string => {
  if (!doc) {
    return null
  }
  try {
    return target.path({ doc, req }) ?? null
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

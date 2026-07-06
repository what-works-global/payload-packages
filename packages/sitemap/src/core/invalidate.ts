import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  JsonObject,
  Payload,
  PayloadRequest,
} from 'payload'

import type { InternalSitemapCollectionConfig, ResolvedSitemapConfig } from '../types.js'

import { getSitemapConfig } from './resolved.js'

/** Groups already scheduled for invalidation within one request (bulk-operation dedupe). */
const scheduledPerRequest = new WeakMap<PayloadRequest, Set<string>>()

type NextServerModule = { after?: (fn: () => void) => void }

/**
 * Runs `fn` after the current request settles. `afterChange` hooks execute inside
 * the operation's transaction — invalidating immediately could regenerate from a
 * pre-commit snapshot. Next's `after()` fires post-response (post-commit); outside
 * a Next request scope we fall back to a macrotask, which the local API's awaited
 * operation has committed by.
 */
const runAfterRequest = (fn: () => void): void => {
  void import('next/server').then(
    (mod: NextServerModule) => {
      try {
        if (mod.after) {
          mod.after(fn)
          return
        }
      } catch {
        // `after()` throws outside a Next request scope (scripts, workers).
      }
      setTimeout(fn, 0)
    },
    () => setTimeout(fn, 0),
  )
}

export const scheduleInvalidation = (
  req: PayloadRequest,
  config: ResolvedSitemapConfig,
  group: string,
): void => {
  let scheduled = scheduledPerRequest.get(req)
  if (!scheduled) {
    scheduled = new Set()
    scheduledPerRequest.set(req, scheduled)
  }
  if (scheduled.has(group)) {
    return
  }
  scheduled.add(group)

  const logger = req.payload.logger
  runAfterRequest(() => {
    Promise.resolve(config.cache.invalidate([group])).catch((err: unknown) => {
      logger.error({ err }, `[payload-sitemap] Failed to invalidate group "${group}"`)
    })
  })
}

const defaultShouldInvalidate = (doc: JsonObject, previousDoc?: JsonObject): boolean => {
  const status = doc._status
  // No drafts on this collection — every change is live.
  if (typeof status !== 'string') {
    return true
  }
  // Skip draft saves unless they transition a published doc (unpublish).
  return status === 'published' || previousDoc?._status === 'published'
}

export const createAfterChangeHook = (
  slug: string,
  collConfig: InternalSitemapCollectionConfig,
  config: ResolvedSitemapConfig,
): CollectionAfterChangeHook => {
  return ({ doc, operation, previousDoc, req }) => {
    const shouldInvalidate = collConfig.shouldInvalidate
      ? collConfig.shouldInvalidate({ doc, operation, previousDoc })
      : defaultShouldInvalidate(doc, previousDoc)
    if (shouldInvalidate) {
      scheduleInvalidation(req, config, slug)
    }
    return doc
  }
}

export const createAfterDeleteHook = (
  slug: string,
  config: ResolvedSitemapConfig,
): CollectionAfterDeleteHook => {
  return ({ doc, req }) => {
    scheduleInvalidation(req, config, slug)
    return doc
  }
}

/**
 * Manually invalidate cached sitemap groups — e.g. from a hook on a global that
 * feeds the `routes` option. Invalidates every group when none are given.
 */
export const invalidateSitemap = async (payload: Payload, groups?: string[]): Promise<void> => {
  const config = getSitemapConfig(payload.config)
  await config.cache.invalidate(groups ?? config.groups)
}

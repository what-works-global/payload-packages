import type { Payload } from 'payload'

import { cache } from 'react'

export type LoggedDocumentStatus = 'live' | 'missing' | 'trashed' | 'unknown'

type Batcher<T> = (scope: string, id: string) => Promise<T>

/**
 * DataLoader-style batcher: `load(scope, id)` calls made while a render pass
 * settles are flushed as ONE query per scope (collection/global slug), so a
 * 50-row list costs a couple of `in` queries instead of two per row. Instances
 * are request-scoped via React `cache`, so results are shared between the
 * document and version cells and never leak across requests.
 */
export const createBatcher = <T>(
  runBatch: (scope: string, ids: string[]) => Promise<Map<string, T>>,
  { notFound, onError }: { notFound: T; onError: T },
): Batcher<T> => {
  const pending = new Map<string, Map<string, Array<(value: T) => void>>>()
  let scheduled = false

  const runScope = async (scope: string, byId: Map<string, Array<(value: T) => void>>) => {
    try {
      const results = await runBatch(scope, [...byId.keys()])
      for (const [id, resolvers] of byId) {
        const value = results.has(id) ? (results.get(id) as T) : notFound
        for (const resolve of resolvers) {
          resolve(value)
        }
      }
    } catch {
      for (const resolvers of byId.values()) {
        for (const resolve of resolvers) {
          resolve(onError)
        }
      }
    }
  }

  const flush = () => {
    scheduled = false
    const batches = [...pending.entries()]
    pending.clear()
    for (const [scope, byId] of batches) {
      void runScope(scope, byId)
    }
  }

  return (scope, id) =>
    new Promise<T>((resolve) => {
      let byId = pending.get(scope)
      if (!byId) {
        byId = new Map()
        pending.set(scope, byId)
      }
      const resolvers = byId.get(id)
      if (resolvers) {
        resolvers.push(resolve)
      } else {
        byId.set(id, [resolve])
      }
      if (!scheduled) {
        scheduled = true
        setTimeout(flush, 0)
      }
    })
}

const getDocumentStatusLoader = cache(
  (payload: Payload): Batcher<LoggedDocumentStatus> =>
    createBatcher<LoggedDocumentStatus>(
      async (collectionSlug, ids) => {
        const result = await payload.find({
          collection: collectionSlug,
          depth: 0,
          limit: ids.length,
          pagination: false,
          select: { deletedAt: true },
          // Include trashed documents; ignored on collections without trash.
          trash: true,
          where: { id: { in: ids } },
        })
        const statuses = new Map<string, LoggedDocumentStatus>()
        for (const doc of result.docs as Array<{ deletedAt?: null | string; id: unknown }>) {
          statuses.set(String(doc.id), doc.deletedAt ? 'trashed' : 'live')
        }
        return statuses
      },
      { notFound: 'missing', onError: 'unknown' },
    ),
)

const getCollectionVersionLoader = cache(
  (payload: Payload): Batcher<boolean> =>
    createBatcher<boolean>(
      async (collectionSlug, ids) => {
        const result = await payload.findVersions({
          collection: collectionSlug,
          depth: 0,
          limit: ids.length,
          select: { parent: true },
          where: { id: { in: ids } },
        })
        return new Map(result.docs.map((doc) => [String(doc.id), true]))
      },
      { notFound: false, onError: false },
    ),
)

const getGlobalVersionLoader = cache(
  (payload: Payload): Batcher<boolean> =>
    createBatcher<boolean>(
      async (globalSlug, ids) => {
        const result = await payload.findGlobalVersions({
          slug: globalSlug,
          depth: 0,
          limit: ids.length,
          select: { createdAt: true },
          where: { id: { in: ids } },
        })
        return new Map(result.docs.map((doc) => [String(doc.id), true]))
      },
      { notFound: false, onError: false },
    ),
)

/**
 * Current state of the document a log entry points at, so cells only link to
 * destinations that still resolve.
 */
export const getLoggedDocumentStatus = (
  payload: Payload,
  collectionSlug: string,
  documentId: string,
): Promise<LoggedDocumentStatus> => {
  if (!payload.collections[collectionSlug]) {
    return Promise.resolve('missing')
  }
  return getDocumentStatusLoader(payload)(collectionSlug, documentId)
}

/** Whether the version a log entry recorded still exists (it may have been pruned). */
export const loggedVersionExists = (
  payload: Payload,
  scope: { collectionSlug: string } | { globalSlug: string },
  versionId: string,
): Promise<boolean> => {
  if ('globalSlug' in scope) {
    return getGlobalVersionLoader(payload)(scope.globalSlug, versionId)
  }
  return getCollectionVersionLoader(payload)(scope.collectionSlug, versionId)
}

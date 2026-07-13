import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, Payload } from 'payload'

import type { AlgoliaSearchContext } from './types.js'

import { buildSearchRecord } from './buildRecord.js'
import { getObjectID } from './shared.js'
import { getWaitUntil } from './waitUntil.js'

/*
 * Draft/unpublish semantics adapted from `payload-plugin-algolia`
 * (c) 2024 Will Kent-Daggett, MIT.
 */

const logSyncError =
  (payload: Payload, objectID: string) =>
  (error: unknown): void => {
    payload.logger.error({
      err: error,
      msg: `[algolia-search] failed to sync ${objectID}`,
    })
  }

/**
 * Run an Algolia write according to `awaitSync`. In background mode the write
 * is caught first — schedulers must never see a rejection — then handed to a
 * `waitUntil` scheduler when one exists (config-provided, or Vercel's request
 * context) so serverless runtimes keep the invocation alive until it lands.
 * With no scheduler the promise floats, which is only safe on long-lived
 * servers.
 */
const runSync = async (
  context: AlgoliaSearchContext,
  operation: Promise<unknown>,
  onError: (error: unknown) => void,
): Promise<void> => {
  if (context.awaitSync) {
    await operation
    return
  }
  const settled = operation.catch(onError)
  const waitUntil = context.waitUntil ?? getWaitUntil()
  waitUntil?.(settled)
}

/**
 * Sync a document into the index on change. Draft-aware:
 * - first drafts of never-published docs are ignored
 * - draft saves (autosave) on top of a published doc are ignored — the index
 *   keeps serving the published content
 * - unpublishing (no published version remains) removes the record
 * - trashed docs (`deletedAt`) are removed
 */
export const syncAfterChange =
  (context: AlgoliaSearchContext): CollectionAfterChangeHook =>
  async ({ collection, doc, previousDoc, req }) => {
    if (!context.configured) {
      return doc
    }
    const { payload } = req
    const slug = collection.slug

    try {
      const objectID = getObjectID({ id: doc.id, collectionSlug: slug })
      const indexName = context.indexName
      const client = context.getClient()
      const run = (operation: Promise<unknown>): Promise<void> =>
        runSync(context, operation, logSyncError(payload, objectID))

      if (doc.deletedAt) {
        await run(client.deleteObject({ indexName, objectID }))
        return doc
      }

      const draftsEnabled = Boolean(collection.versions?.drafts)
      if (draftsEnabled && doc._status === 'draft') {
        const hasPrevious = Boolean(previousDoc && previousDoc.id != null)
        if (!hasPrevious) {
          // first draft of a never-published doc — nothing to index or remove
          return doc
        }

        // pending change vs unpublish: only drop the record when no published
        // version remains
        let published: Record<string, unknown> | undefined
        try {
          published = await payload.findByID({
            id: doc.id,
            collection: slug,
            depth: 0,
            draft: false,
            req,
          })
        } catch {
          // no published version
        }
        if (published?._status === 'published') {
          return doc
        }
        await run(client.deleteObject({ indexName, objectID }))
        return doc
      }

      const record = await buildSearchRecord({ collection, context, doc, req })
      if (!record) {
        // the collection's `record` transform opted this doc out of the index
        await run(client.deleteObject({ indexName, objectID }))
        return doc
      }
      await run(client.saveObject({ body: record, indexName }))
    } catch (error) {
      payload.logger.error({
        err: error,
        msg: `[algolia-search] error syncing ${slug} ${String(doc?.id)}`,
      })
    }

    return doc
  }

export const syncAfterDelete =
  (context: AlgoliaSearchContext): CollectionAfterDeleteHook =>
  async ({ id, collection, doc, req }) => {
    if (!context.configured) {
      return doc
    }
    const objectID = getObjectID({
      id: id ?? (doc as { id?: unknown } | undefined)?.id,
      collectionSlug: collection.slug,
    })
    const onError = logSyncError(req.payload, objectID)
    try {
      await runSync(
        context,
        context.getClient().deleteObject({ indexName: context.indexName, objectID }),
        onError,
      )
    } catch (error) {
      onError(error)
    }
    return doc
  }

import type {
  BasePayload,
  CollectionSlug,
  PayloadHandler,
  PayloadRequest,
  SanitizedCollectionConfig,
  Where,
} from 'payload'

import type { AlgoliaSearchContext, BlocksMap, SearchRecord } from './types.js'

import { buildSearchRecord } from './buildRecord.js'
import { pluginKey } from './shared.js'

export interface ReindexResult {
  /** Records pushed per collection slug. */
  indexed: Record<string, number>
  mode: 'all' | 'collection'
  total: number
}

/** The resolved plugin context, for programmatic use (scripts, cron, jobs). */
export const getAlgoliaSearchContext = (payload: BasePayload): AlgoliaSearchContext => {
  const context = (payload.config.custom as Record<string, unknown> | undefined)?.[pluginKey]
  if (!context) {
    throw new Error('[algolia-search] the plugin is not installed on this Payload config')
  }
  return context as AlgoliaSearchContext
}

const collectRecords = async (
  payload: BasePayload,
  context: AlgoliaSearchContext,
  slug: string,
  req?: PayloadRequest,
): Promise<SearchRecord[]> => {
  // `slug` is validated against `context.collections` at runtime, not the generated union
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- no-op here (CollectionSlug = string), required when generated types narrow it
  const collection = payload.collections[slug as CollectionSlug]?.config as
    | SanitizedCollectionConfig
    | undefined
  if (!collection) {
    throw new Error(`[algolia-search] unknown collection "${slug}"`)
  }

  const draftsEnabled = Boolean(collection.versions?.drafts)
  const where: undefined | Where = draftsEnabled ? { _status: { equals: 'published' } } : undefined
  const blocks = (payload as unknown as { blocks?: BlocksMap }).blocks

  const records: SearchRecord[] = []
  let page = 1
  while (true) {
    const result = await payload.find({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see above
      collection: slug as CollectionSlug,
      depth: context.reindex.depth,
      draft: false,
      limit: context.reindex.batchSize,
      overrideAccess: true,
      page,
      where,
    })
    for (const doc of result.docs as Record<string, unknown>[]) {
      const record = await buildSearchRecord({ blocks, collection, context, doc, req })
      if (record) {
        records.push(record)
      }
    }
    if (!result.hasNextPage) {
      break
    }
    page += 1
  }
  return records
}

/**
 * Rebuild the index from the current published content. Also usable directly
 * from scripts/jobs: `await runAlgoliaReindex(payload)`.
 *
 * - full reindex — `replaceAllObjects`: atomic (temp index + move), so search
 *   never serves an empty index mid-rebuild, and stale records are pruned
 * - single collection — `deleteBy` the collection facet, then `saveObjects`;
 *   Algolia applies index operations in order, so no gap is observable
 *
 * Index settings are pushed first so relevance config always matches the code.
 */
export async function runAlgoliaReindex(
  payload: BasePayload,
  args: { collection?: string; req?: PayloadRequest } = {},
): Promise<ReindexResult> {
  const context = getAlgoliaSearchContext(payload)
  if (!context.configured) {
    throw new Error(
      '[algolia-search] missing Algolia credentials — set algolia.appId, apiKey and index',
    )
  }
  if (args.collection && !context.collections[args.collection]) {
    throw new Error(`[algolia-search] collection "${args.collection}" is not configured for search`)
  }

  const client = context.getClient()
  const indexName = context.indexName

  if (context.indexSettings !== false) {
    await client.setSettings({ indexName, indexSettings: context.indexSettings })
  }

  const slugs = args.collection ? [args.collection] : Object.keys(context.collections)
  const indexed: Record<string, number> = {}
  const objects: SearchRecord[] = []
  for (const slug of slugs) {
    const records = await collectRecords(payload, context, slug, args.req)
    indexed[slug] = records.length
    objects.push(...records)
  }

  if (args.collection) {
    await client.deleteBy({
      deleteByParams: { filters: `collection:"${args.collection}"` },
      indexName,
    })
    if (objects.length) {
      await client.saveObjects({ indexName, objects })
    }
  } else {
    await client.replaceAllObjects({ batchSize: 1000, indexName, objects })
  }

  return {
    indexed,
    mode: args.collection ? 'collection' : 'all',
    total: objects.length,
  }
}

/** `POST <path>?collection=<slug>` — omit the param to rebuild everything. */
export const createReindexHandler =
  (context: AlgoliaSearchContext): PayloadHandler =>
  async (req) => {
    const allowed = await context.reindex.access({ req })
    if (!allowed) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!context.configured) {
      return Response.json(
        { error: '[algolia-search] missing Algolia credentials — sync is paused' },
        { status: 503 },
      )
    }

    const collectionParam = req.query?.collection
    const collection =
      typeof collectionParam === 'string' && collectionParam !== '' ? collectionParam : undefined
    if (collection && !context.collections[collection]) {
      return Response.json(
        { error: `Collection "${collection}" is not configured for search` },
        { status: 400 },
      )
    }

    try {
      const result = await runAlgoliaReindex(req.payload, { collection, req })
      return Response.json({ success: true, ...result })
    } catch (error) {
      req.payload.logger.error({ err: error, msg: '[algolia-search] reindex failed' })
      return Response.json(
        { error: error instanceof Error ? error.message : 'Reindex failed' },
        { status: 500 },
      )
    }
  }

import type { PayloadRequest, SanitizedCollectionConfig } from 'payload'

import type { AlgoliaSearchContext, BlocksMap, SearchRecord } from './types.js'

import { extractDocumentText } from './extractText.js'
import { loadLexicalConverter } from './richText.js'
import { getObjectID } from './shared.js'

const toText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return undefined
}

type Breadcrumb = { label?: unknown; url?: unknown }

/**
 * Nested-docs stores the full path of a document as the `url` of its last
 * breadcrumb — the same rule sites use to route to the doc — which makes it
 * the right default `path` when no `getPath` is supplied (or it returns nothing).
 */
const breadcrumbPath = (doc: Record<string, unknown>): string | undefined => {
  const crumbs = doc.breadcrumbs
  if (!Array.isArray(crumbs) || crumbs.length === 0) {
    return undefined
  }
  const url = (crumbs[crumbs.length - 1] as Breadcrumb | undefined)?.url
  return typeof url === 'string' && url ? url : undefined
}

/** Breadcrumb labels, only when there is an actual trail (more than one). */
const breadcrumbLabels = (doc: Record<string, unknown>): string[] | undefined => {
  const crumbs = doc.breadcrumbs
  if (!Array.isArray(crumbs)) {
    return undefined
  }
  const labels = crumbs
    .map((crumb) => (crumb as Breadcrumb | undefined)?.label)
    .filter((label): label is string => typeof label === 'string' && label.trim() !== '')
  return labels.length > 1 ? labels : undefined
}

export interface BuildRecordArgs {
  /** Registered blocks map; defaults to `req.payload.blocks` when available. */
  blocks?: BlocksMap
  collection: SanitizedCollectionConfig
  context: AlgoliaSearchContext
  doc: Record<string, unknown>
  req?: PayloadRequest
}

/** The best-effort record: title / path / breadcrumbs / compressed content. */
export const buildDefaultRecord = ({
  blocks,
  collection,
  context,
  doc,
  req,
}: BuildRecordArgs): SearchRecord => {
  const slug = collection.slug
  const collectionOptions = context.collections[slug] ?? {}

  const useAsTitle = collection.admin?.useAsTitle
  const titleField =
    useAsTitle && useAsTitle !== 'id'
      ? useAsTitle
      : typeof doc.title === 'string'
        ? 'title'
        : undefined
  const title = titleField ? toText(doc[titleField]) : undefined

  const exclude = [...(collectionOptions.excludeFields ?? context.excludeFields)]
  if (titleField) {
    exclude.push(titleField)
  }

  const getPath = collectionOptions.getPath ?? context.getPath
  const path = toText(getPath?.({ collection, doc, req })) ?? breadcrumbPath(doc)
  const breadcrumbs = breadcrumbLabels(doc)

  const content = extractDocumentText({
    blocks: blocks ?? (req?.payload as unknown as { blocks?: BlocksMap } | undefined)?.blocks,
    data: doc,
    exclude,
    fields: collection.fields,
    limit: collectionOptions.contentLimit ?? context.contentLimit,
    richTextToText: context.richTextToText,
  })

  return {
    ...(title !== undefined ? { title } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(breadcrumbs !== undefined ? { breadcrumbs } : {}),
    ...(content ? { content } : {}),
    collection: slug,
    objectID: getObjectID({ id: doc.id, collectionSlug: slug }),
  }
}

/**
 * Default record run through the collection's `record` transform (when set).
 * Returns `null` when the document should be kept out of the index.
 */
export const buildSearchRecord = async (args: BuildRecordArgs): Promise<null | SearchRecord> => {
  // make sure the (memoized) Lexical plaintext converter had a chance to load
  await loadLexicalConverter()
  const defaultRecord = buildDefaultRecord(args)
  const transform = args.context.collections[args.collection.slug]?.record
  if (!transform) {
    return defaultRecord
  }
  const result = await transform({
    collection: args.collection,
    defaultRecord,
    doc: args.doc,
    req: args.req,
  })
  if (result === undefined) {
    return defaultRecord
  }
  if (result === null) {
    return null
  }
  // canonical keys always win so deletes and per-collection reindexes keep working
  return { ...result, collection: defaultRecord.collection, objectID: defaultRecord.objectID }
}

import { getSchemaMap } from '@payloadcms/ui/utilities/getSchemaMap'
import {
  type Field,
  type FieldSchemaMap,
  type PayloadRequest,
  type SanitizedCollectionConfig,
} from 'payload'

import { getLabel } from './utils.js'

export interface SchemaPathSegment {
  label: string
  name: string
}

export interface IndexPathSegment {
  label: number | string
  name: number | string
}

type TraverseDocumentResult = boolean | void
type MaybePromise<T> = Promise<T> | T

export type TraverseDocumentRecursiveArgs = TraverseDocumentArgs & TraverseDocumentCallbackArgs

export type TraverseDocumentCallbackArgs = {
  field: Field
  /** If there's any arrays in the document, the indexPathSegments will have the indices of array items as well */
  indexPathSegments: IndexPathSegment[]
  schemaMap: FieldSchemaMap
  /** The path to the field in the collection schema */
  schemaPathSegments: SchemaPathSegment[]
  siblingData?: Record<string, unknown>
  value: unknown
}

export type TraverseFieldsCallback = (
  args: TraverseDocumentCallbackArgs,
) => MaybePromise<TraverseDocumentResult>

export interface TraverseDocumentArgs {
  /**
   * Callback invoked for each visited field/value pair during traversal.
   *
   * Return a truthy value to short-circuit traversal.
   *
   * Sync behavior:
   * - A truthy return stops traversal immediately.
   *
   * Async behavior:
   * - A truthy resolved value stops scheduling additional traversal work.
   * - Already-started async callbacks are not canceled.
   */
  callback: TraverseFieldsCallback
  collection: SanitizedCollectionConfig
  doc: any
  req: PayloadRequest
}

export interface TraverseDocumentSyncArgs extends Omit<TraverseDocumentArgs, 'callback'> {
  /**
   * Callback invoked for each visited field/value pair during traversal.
   *
   * Return a truthy value to short-circuit traversal.
   *
   * Sync behavior:
   * - A truthy return stops traversal immediately.
   *
   * Async behavior:
   * - A truthy resolved value stops scheduling additional traversal work.
   * - Already-started async callbacks are not canceled.
   */
  callback: (args: TraverseDocumentCallbackArgs) => TraverseDocumentResult
}

export interface TraverseDocumentAsyncArgs extends Omit<TraverseDocumentArgs, 'callback'> {
  /**
   * Callback invoked for each visited field/value pair during traversal.
   *
   * Return a truthy value to short-circuit traversal.
   *
   * Sync behavior:
   * - A truthy return stops traversal immediately.
   *
   * Async behavior:
   * - A truthy resolved value stops scheduling additional traversal work.
   * - Already-started async callbacks are not canceled.
   */
  callback: (args: TraverseDocumentCallbackArgs) => Promise<TraverseDocumentResult>
}

type TraverseEntry = {
  key: string
  originalIndex: number
  schemaPath: string
  schemaRank: number
  value: unknown
}

type TraversalContext = {
  callback: TraverseFieldsCallback
  collection: SanitizedCollectionConfig
  collectionSlug: string
  doc: any
  pendingResults: Promise<TraverseDocumentResult>[]
  req: PayloadRequest
  schemaMap: FieldSchemaMap
  schemaPathOrder: Map<string, number>
  shouldStop: boolean
}

const isPromiseLike = <T>(value: MaybePromise<T>): value is Promise<T> => {
  return typeof (value as Promise<T>)?.then === 'function'
}

const getPathNames = (segments: SchemaPathSegment[]): string[] =>
  segments.map((segment) => segment.name)

const getSchemaPath = (
  collectionSlug: string,
  schemaPathSegments: SchemaPathSegment[],
  key: string,
): string => {
  return [collectionSlug, ...getPathNames(schemaPathSegments), key].join('.')
}

const getObjectEntries = (value: unknown): [string, unknown][] => {
  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value as Record<string, unknown>)
}

const sortEntriesBySchemaOrder = (args: {
  collectionSlug: string
  entries: [string, unknown][]
  schemaPathOrder: Map<string, number>
  schemaPathSegments: SchemaPathSegment[]
}): TraverseEntry[] => {
  const { collectionSlug, entries, schemaPathOrder, schemaPathSegments } = args

  const rankedEntries = entries.map(([key, value], originalIndex) => {
    const schemaPath = getSchemaPath(collectionSlug, schemaPathSegments, key)
    const schemaRank = schemaPathOrder.get(schemaPath) ?? Number.POSITIVE_INFINITY

    return {
      key,
      originalIndex,
      schemaPath,
      schemaRank,
      value,
    }
  })

  rankedEntries.sort((a, b) => {
    if (a.schemaRank !== b.schemaRank) {
      return a.schemaRank - b.schemaRank
    }

    return a.originalIndex - b.originalIndex
  })

  return rankedEntries
}

const handleCallbackResult = (
  context: TraversalContext,
  callbackResult: MaybePromise<TraverseDocumentResult>,
): void => {
  if (isPromiseLike(callbackResult)) {
    context.pendingResults.push(
      callbackResult.then((result) => {
        if (result) {
          context.shouldStop = true
        }
        return result
      }),
    )
    return
  }

  if (callbackResult) {
    context.shouldStop = true
  }
}

/**
 * Iterate and recurse a document's values, calling a callback for each field and value.
 *
 * @param fields
 * @param callback callback called for each field, discontinue looping if callback returns truthy
 * @param fillEmpty fill empty properties to use this without data
 * @param ref the data or any artifacts assigned in the callback during field recursion
 * @param parentRef the data or any artifacts assigned in the callback during field recursion one level up
 */
export function traverseDocument(args: TraverseDocumentSyncArgs): void
export function traverseDocument(args: TraverseDocumentAsyncArgs): Promise<void>
export function traverseDocument(args: TraverseDocumentArgs): Promise<void> | void
export function traverseDocument(args: TraverseDocumentArgs): Promise<void> | void {
  const { collection, doc, req } = args

  // `PayloadRequest['i18n']` and `getSchemaMap`'s `I18nClient` come from different
  // package instances in this repo, so bridge them at the call site.
  const i18n = req.i18n as Parameters<typeof getSchemaMap>[0]['i18n']

  const schemaMap = getSchemaMap({
    collectionSlug: collection.slug,
    config: req.payload.config,
    i18n,
  })
  const schemaPathOrder = new Map<string, number>()
  let schemaRank = 0
  for (const schemaPath of schemaMap.keys()) {
    schemaPathOrder.set(schemaPath, schemaRank)
    schemaRank += 1
  }

  const context: TraversalContext = {
    callback: args.callback,
    collection,
    collectionSlug: collection.slug,
    doc,
    pendingResults: [],
    req,
    schemaMap,
    schemaPathOrder,
    shouldStop: false,
  }

  const collectionSlug = collection.slug
  const schemaPathSegments: SchemaPathSegment[] = []
  const indexPathSegments: IndexPathSegment[] = []

  const sortedEntries = sortEntriesBySchemaOrder({
    collectionSlug,
    entries: getObjectEntries(doc),
    schemaPathOrder: context.schemaPathOrder,
    schemaPathSegments,
  })

  for (const entry of sortedEntries) {
    if (context.shouldStop) {
      break
    }

    const field = schemaMap.get(entry.schemaPath)
    if (field && 'type' in field) {
      const label = getLabel(field, req) ?? entry.key
      const newSegment = { name: entry.key, label }
      const newSchemaPathSegments = [...schemaPathSegments, newSegment]
      const newIndexPathSegments = [...indexPathSegments, newSegment]
      traverseDocumentRecursive(context, {
        ...args,
        field: field as unknown as never,
        indexPathSegments: newIndexPathSegments,
        schemaMap,
        schemaPathSegments: newSchemaPathSegments,
        siblingData: doc,
        value: entry.value,
      })
    }
  }

  if (context.pendingResults.length > 0) {
    return Promise.all(context.pendingResults).then(() => undefined)
  }
}

const traverseDocumentRecursive = (
  context: TraversalContext,
  args: TraverseDocumentRecursiveArgs,
): void => {
  if (context.shouldStop) {
    return
  }

  const {
    collection,
    field,
    indexPathSegments,
    req,
    schemaMap,
    schemaPathSegments,
    siblingData,
    value,
  } = args

  const callbackResult = args.callback({
    field,
    indexPathSegments,
    schemaMap,
    schemaPathSegments,
    siblingData,
    value,
  })
  handleCallbackResult(context, callbackResult)

  if (context.shouldStop) {
    return
  }

  const collectionSlug = collection.slug
  if (field.type === 'array') {
    if (!Array.isArray(value)) {
      return
    }

    for (const [index, obj] of value.entries()) {
      if (context.shouldStop) {
        break
      }
      if (!obj || typeof obj !== 'object') {
        continue
      }

      const sortedEntries = sortEntriesBySchemaOrder({
        collectionSlug,
        entries: getObjectEntries(obj).filter(([key]) => key !== 'id'),
        schemaPathOrder: context.schemaPathOrder,
        schemaPathSegments,
      })

      for (const entry of sortedEntries) {
        if (context.shouldStop) {
          break
        }

        const indexSegment = { name: index, label: index }
        const nestedField = schemaMap.get(entry.schemaPath)
        if (nestedField && 'type' in nestedField) {
          const label = getLabel(nestedField, req) ?? entry.key
          const newSegment = { name: entry.key, label }
          traverseDocumentRecursive(context, {
            callback: args.callback,
            collection,
            doc: args.doc,
            field: nestedField as unknown as never,
            indexPathSegments: [...indexPathSegments, indexSegment, newSegment],
            req: args.req,
            schemaMap: args.schemaMap,
            schemaPathSegments: [...schemaPathSegments, newSegment],
            siblingData: obj as Record<string, unknown>,
            value: entry.value,
          })
        }
      }
    }
  } else if (field.type === 'group') {
    const sortedEntries = sortEntriesBySchemaOrder({
      collectionSlug,
      entries: getObjectEntries(value),
      schemaPathOrder: context.schemaPathOrder,
      schemaPathSegments,
    })

    for (const entry of sortedEntries) {
      if (context.shouldStop) {
        break
      }

      const nestedField = schemaMap.get(entry.schemaPath)
      if (nestedField && 'type' in nestedField) {
        const label = getLabel(nestedField, req) ?? entry.key
        const newSegment = { name: entry.key, label }
        traverseDocumentRecursive(context, {
          callback: args.callback,
          collection,
          doc: args.doc,
          field: nestedField as unknown as never,
          indexPathSegments: [...indexPathSegments, newSegment],
          req: args.req,
          schemaMap: args.schemaMap,
          schemaPathSegments: [...schemaPathSegments, newSegment],
          siblingData: value as Record<string, unknown>,
          value: entry.value,
        })
      }
    }
  }
}

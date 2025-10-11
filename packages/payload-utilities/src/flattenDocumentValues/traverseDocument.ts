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

export type TraverseDocumentRecursiveArgs = {
  schemaMap: FieldSchemaMap
} & TraverseDocumentArgs &
  TraverseDocumentCallbackArgs

export type TraverseDocumentCallbackArgs = {
  field: Field
  /** If there's any arrays in the document, the indexPathSegments will have the indices of array items as well */
  indexPathSegments: IndexPathSegment[]
  /** The path to the field in the collection schema */
  schemaPathSegments: SchemaPathSegment[]
  siblingData?: Record<string, unknown>
  value: unknown
}

export type TraverseFieldsCallback = (args: TraverseDocumentCallbackArgs) => boolean | void

export interface TraverseDocumentArgs {
  callback: TraverseFieldsCallback
  collection: SanitizedCollectionConfig
  doc: any
  req: PayloadRequest
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
export const traverseDocument = (args: TraverseDocumentArgs): void => {
  const { collection, doc, req } = args

  const schemaMap = getSchemaMap({
    collectionSlug: collection.slug,
    config: req.payload.config,
    i18n: req.i18n,
  })
  const schemaKeysArray = Array.from(schemaMap.keys())
  const collectionSlug = collection.slug
  const schemaPathSegments: SchemaPathSegment[] = []
  const indexPathSegments: IndexPathSegment[] = []

  // Sort Object.entries by the order of keys in schemaMap
  const sortedEntries = Object.entries(doc).sort(([keyA], [keyB]) => {
    const schemaPathA = [collectionSlug, ...schemaPathSegments.map((s) => s.name), keyA].join('.')
    const schemaPathB = [collectionSlug, ...schemaPathSegments.map((s) => s.name), keyB].join('.')
    const indexA = schemaKeysArray.indexOf(schemaPathA)
    const indexB = schemaKeysArray.indexOf(schemaPathB)
    return indexA - indexB
  })

  for (const [key, value] of sortedEntries) {
    const schemaPath = [collectionSlug, ...schemaPathSegments.map((s) => s.name), key].join('.')
    const field = schemaMap.get(schemaPath)
    if (field && 'type' in field) {
      const label = getLabel(field, req) ?? key
      const newSegment = { name: key, label }
      const newSchemaPathSegments = [...schemaPathSegments, newSegment]
      const newIndexPathSegments = [...indexPathSegments, newSegment]
      const result = traverseDocumentRecursive({
        ...args,
        field: field as unknown as never,
        indexPathSegments: newIndexPathSegments,
        schemaMap,
        schemaPathSegments: newSchemaPathSegments,
        siblingData: doc,
        value,
      })
      if (result) {
        return
      }
    }
  }
}

const traverseDocumentRecursive = (args: TraverseDocumentRecursiveArgs): boolean | void => {
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

  const result = args.callback({
    field,
    indexPathSegments,
    schemaPathSegments,
    siblingData,
    value,
  })

  if (result) {
    return result
  }

  const collectionSlug = collection.slug
  if (field.type === 'array') {
    ;(value as any[]).forEach((obj, index) => {
      Object.entries(obj).forEach(([key, value2]) => {
        if (key !== 'id') {
          const schemaPath = [collectionSlug, ...schemaPathSegments.map((s) => s.name), key].join(
            '.',
          )
          const indexSegment = { name: index, label: index }
          const field = schemaMap.get(schemaPath)
          if (field && 'type' in field) {
            const label = getLabel(field, req) ?? key
            const newSegment = { name: key, label }
            traverseDocumentRecursive({
              callback: args.callback,
              collection,
              doc: args.doc,
              field: field as unknown as never,
              indexPathSegments: [...indexPathSegments, indexSegment, newSegment],
              req: args.req,
              schemaMap: args.schemaMap,
              schemaPathSegments: [...schemaPathSegments, newSegment],
              siblingData: obj,
              value: value2,
            })
          }
        }
      })
    })
  } else if (field.type === 'group') {
    Object.entries(value as Record<string, unknown>).forEach(([key, value2]) => {
      const schemaPath = [collectionSlug, ...schemaPathSegments.map((s) => s.name), key].join('.')
      const field = schemaMap.get(schemaPath)
      if (field && 'type' in field) {
        const label = getLabel(field, req) ?? key
        const newSegment = { name: key, label }
        traverseDocumentRecursive({
          callback: args.callback,
          collection,
          doc: args.doc,
          field: field as unknown as never,
          indexPathSegments: [...indexPathSegments, newSegment],
          req: args.req,
          schemaMap: args.schemaMap,
          schemaPathSegments: [...schemaPathSegments, newSegment],
          siblingData: value as Record<string, unknown>,
          value: value2,
        })
      }
    })
  }
}

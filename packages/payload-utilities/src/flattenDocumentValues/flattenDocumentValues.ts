import { getSchemaMap } from '@payloadcms/ui/utilities/getSchemaMap'
import { type Field, type PayloadRequest, type SanitizedCollectionConfig } from 'payload'

import type { FieldResolvers } from './resolvers.js'

import { getLabel } from './utils.js'

export interface SchemaPathSegment {
  label: string
  name: string
}

export interface IndexPathSegment {
  label: number | string
  name: number | string
}

export interface FlattenedFieldValue {
  field: Field
  /** If there's any arrays in the document, the indexPathSegments will have the indices of array items as well */
  indexPathSegments: IndexPathSegment[]
  /** The path to the field in the collection schema */
  schemaPathSegments: SchemaPathSegment[]
  value: string
}

export interface FlattenDocumentValuesArgs {
  collection: SanitizedCollectionConfig
  doc: any
  /**
   * A list of schema path strings to exclude from the email
   * @default ['updatedAt', 'createdAt']
   * @example ['group.subFieldName','array.subFieldName']
   */
  excludedFields?: string[]
  fieldResolvers: FieldResolvers
  req: PayloadRequest
}

/** Maps over a document and returns an array of flattened field values */
export const flattenDocumentValues = async (
  args: FlattenDocumentValuesArgs,
): Promise<FlattenedFieldValue[]> => {
  const { collection, doc, excludedFields = ['updatedAt', 'createdAt'], fieldResolvers, req } = args

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

  return (
    await Promise.all(
      sortedEntries.map(async ([key, value]) => {
        const schemaPathNoCollectionSlug = [...schemaPathSegments.map((s) => s.name), key].join('.')
        const schemaPath = [collectionSlug, ...schemaPathSegments.map((s) => s.name), key].join('.')
        if (!excludedFields.includes(schemaPathNoCollectionSlug)) {
          const field = schemaMap.get(schemaPath)
          if (field && 'type' in field) {
            const label = getLabel(field, req) ?? key
            const newSegment = { name: key, label }
            const newSchemaPathSegments = [...schemaPathSegments, newSegment]
            const newIndexPathSegments = [...indexPathSegments, newSegment]
            const resolver = fieldResolvers[field.type]
            return await resolver({
              ...args,
              data: value,
              excludedFields,
              field: field as unknown as never,
              indexPathSegments: newIndexPathSegments,
              schemaMap,
              schemaPathSegments: newSchemaPathSegments,
            })
          }
        }
        return []
      }),
    )
  ).flat()
}

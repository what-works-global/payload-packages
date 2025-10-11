import { getSchemaMap } from '@payloadcms/ui/utilities/getSchemaMap'
import { type Field, type PayloadRequest, type SanitizedCollectionConfig } from 'payload'

import type { FieldResolvers } from './resolvers.js'

import {
  type IndexPathSegment,
  type SchemaPathSegment,
  traverseDocument,
} from './traverseDocument.js'

export interface FlattenedFieldValue {
  field: Field
  /** If there's any arrays in the document, the indexPathSegments will have the indices of array items as well */
  indexPathSegments: IndexPathSegment[]
  /** The path to the field in the collection schema */
  schemaPathSegments: SchemaPathSegment[]
  value: any
}

export interface FlattenDocumentValuesArgs {
  collection: SanitizedCollectionConfig
  doc: any
  req: PayloadRequest
}

/** Maps over a document and returns an array of flattened field values */
export const flattenDocumentValuesV2 = (args: FlattenDocumentValuesArgs): FlattenedFieldValue[] => {
  const flattenedValues: FlattenedFieldValue[] = []

  traverseDocument({
    callback: ({ field, indexPathSegments, schemaPathSegments, value }) => {
      flattenedValues.push({
        field,
        indexPathSegments,
        schemaPathSegments,
        value,
      })
    },
    ...args,
  })

  return flattenedValues
}

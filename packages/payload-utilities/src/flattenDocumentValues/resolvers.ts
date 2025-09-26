import { type Field, type FieldSchemaMap } from 'payload'

import type {
  FlattenDocumentValuesArgs,
  FlattenedFieldValue,
  IndexPathSegment,
  SchemaPathSegment,
} from './index.js'

import { arrayResolver } from './resolvers/arrayResolver.js'
import { groupResolver } from './resolvers/groupResolver.js'
import { simpleResolver } from './resolvers/simpleResolver.js'

type ExtractFieldByType<T extends Field['type']> = Extract<Field, { type: T }>

// Typed resolver function arguments
export type FieldResolverArgs<T extends Field['type']> = {
  data: any
  excludedFields: string[]
  field: ExtractFieldByType<T>
  /** If there's any arrays in the document, the indexPathSegments will have the indices of array items as well */
  indexPathSegments: IndexPathSegment[]
  schemaMap: FieldSchemaMap
  /** The path to the field in the collection schema */
  schemaPathSegments: SchemaPathSegment[]
} & Omit<FlattenDocumentValuesArgs, 'doc' | 'excludedFields'>

export type FieldResolver<T extends Field['type']> = (
  args: FieldResolverArgs<T>,
) => FlattenedFieldValue[] | Promise<FlattenedFieldValue[]>

export type FieldResolvers = {
  [K in Field['type']]: FieldResolver<K>
}

// Example implementation
export const defaultFieldResolvers: FieldResolvers = {
  array: arrayResolver,
  blocks: simpleResolver,
  checkbox: simpleResolver,
  code: simpleResolver,
  collapsible: simpleResolver,
  date: simpleResolver,
  email: simpleResolver,
  group: groupResolver,
  join: simpleResolver,
  json: simpleResolver,
  number: simpleResolver,
  point: simpleResolver,
  radio: simpleResolver,
  relationship: simpleResolver,
  richText: simpleResolver,
  row: simpleResolver,
  select: simpleResolver,
  tabs: simpleResolver,
  text: simpleResolver,
  textarea: simpleResolver,
  ui: simpleResolver,
  upload: simpleResolver,
}

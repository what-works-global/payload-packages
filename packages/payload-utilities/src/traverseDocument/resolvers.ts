import { type Field, type PayloadRequest, type SanitizedCollectionConfig } from 'payload'

import type { TraverseDocumentCallbackArgs } from './traverseDocument.js'
import type { ExtractFieldByType } from './utils.js'

type MaybePromise<T> = Promise<T> | T

// Typed field-value resolver function arguments
export type FieldResolverArgs<T extends Field['type']> = {
  collection: SanitizedCollectionConfig
  doc: any
  field: ExtractFieldByType<T>
  req: PayloadRequest
  value: unknown
} & Omit<TraverseDocumentCallbackArgs, 'field' | 'value'>

/**
 * Resolves a single field value.
 *
 * Return `undefined` to indicate "no change".
 */
export type FieldResolver<T extends Field['type']> = (
  args: FieldResolverArgs<T>,
) => MaybePromise<unknown>

export type FieldResolvers = Partial<{
  [K in Field['type']]: FieldResolver<K>
}>

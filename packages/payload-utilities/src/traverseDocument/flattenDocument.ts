import { type Field, type PayloadRequest, type SanitizedCollectionConfig } from 'payload'

import type { FieldResolvers } from './resolvers.js'

import {
  type IndexPathSegment,
  type SchemaPathSegment,
  traverseDocument,
} from './traverseDocument.js'

export interface FlattenedDocumentValue {
  field: Field
  /** If there's any arrays in the document, the indexPathSegments will have the indices of array items as well */
  indexPathSegments: IndexPathSegment[]
  /** The path to the field in the collection schema */
  schemaPathSegments: SchemaPathSegment[]
  value: unknown
}

export interface FlattenDocumentArgs {
  collection: SanitizedCollectionConfig
  doc: unknown
  excludedFields?: string[]
  fieldResolvers?: FieldResolvers
  req: PayloadRequest
}

const getSchemaPath = (collectionSlug: string, schemaPathSegments: SchemaPathSegment[]): string => {
  return [collectionSlug, ...schemaPathSegments.map((segment) => segment.name)].join('.')
}

const getArrayIndices = (indexPathSegments: IndexPathSegment[]): number[] => {
  return indexPathSegments
    .map((segment) => segment.name)
    .filter((segment): segment is number => typeof segment === 'number')
}

const compareArrayIndices = (indicesA: number[], indicesB: number[]): number => {
  const minLength = Math.min(indicesA.length, indicesB.length)

  for (let i = 0; i < minLength; i += 1) {
    if (indicesA[i] !== indicesB[i]) {
      return indicesA[i] - indicesB[i]
    }
  }

  return indicesA.length - indicesB.length
}

const sortFlattenedValuesComparator = (args: {
  collectionSlug: string
  schemaPathOrder: Map<string, number>
}) => {
  const { collectionSlug, schemaPathOrder } = args

  return (a: FlattenedDocumentValue, b: FlattenedDocumentValue): number => {
    const schemaPathA = getSchemaPath(collectionSlug, a.schemaPathSegments)
    const schemaPathB = getSchemaPath(collectionSlug, b.schemaPathSegments)

    const schemaRankA = schemaPathOrder.get(schemaPathA) ?? Number.POSITIVE_INFINITY
    const schemaRankB = schemaPathOrder.get(schemaPathB) ?? Number.POSITIVE_INFINITY

    if (schemaRankA !== schemaRankB) {
      return schemaRankA - schemaRankB
    }

    const indicesComparison = compareArrayIndices(
      getArrayIndices(a.indexPathSegments),
      getArrayIndices(b.indexPathSegments),
    )
    if (indicesComparison !== 0) {
      return indicesComparison
    }

    if (schemaPathA !== schemaPathB) {
      return schemaPathA.localeCompare(schemaPathB)
    }

    return 0
  }
}

/** Maps over a document and returns an array of flattened field values */
export const flattenDocument = async (
  args: FlattenDocumentArgs,
): Promise<FlattenedDocumentValue[]> => {
  const flattenedValues: FlattenedDocumentValue[] = []
  const collectionSlug = args.collection.slug
  const excludedFields = args.excludedFields ?? []
  const fieldResolvers = args.fieldResolvers
  let schemaPathOrder: Map<string, number> | undefined

  await traverseDocument({
    callback: async ({
      field,
      indexPathSegments,
      schemaMap,
      schemaPathSegments,
      siblingData,
      value,
    }) => {
      const schemaPathNoCollectionSlug = schemaPathSegments.map((segment) => segment.name).join('.')
      if (excludedFields.includes(schemaPathNoCollectionSlug)) {
        return
      }

      if (!schemaPathOrder) {
        schemaPathOrder = new Map<string, number>()
        let rank = 0
        for (const schemaPath of schemaMap.keys()) {
          schemaPathOrder.set(schemaPath, rank)
          rank += 1
        }
      }

      const resolver = fieldResolvers?.[field.type]
      const resolvedValue = resolver
        ? await resolver({
            collection: args.collection,
            doc: args.doc,
            field: field as never,
            indexPathSegments,
            req: args.req,
            schemaMap,
            schemaPathSegments,
            siblingData,
            value,
          })
        : undefined

      flattenedValues.push({
        field,
        indexPathSegments,
        schemaPathSegments,
        value: typeof resolvedValue === 'undefined' ? value : resolvedValue,
      })
    },
    ...args,
  })

  if (schemaPathOrder) {
    flattenedValues.sort(
      sortFlattenedValuesComparator({
        collectionSlug,
        schemaPathOrder,
      }),
    )
  }

  return flattenedValues
}

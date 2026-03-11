import { type PayloadRequest, type SanitizedCollectionConfig } from 'payload'

import type { FieldResolvers } from './resolvers.js'

import { traverseDocument } from './traverseDocument.js'

type PathSegment = number | string

type ResolvedPatch = {
  path: PathSegment[]
  value: unknown
  visitOrder: number
}

export interface TransformDocumentArgs {
  collection: SanitizedCollectionConfig
  doc: unknown
  /**
   * A list of schema path strings to exclude from value resolution.
   * @example ['group.subFieldName', 'array.subFieldName']
   */
  excludedFields?: string[]
  fieldResolvers?: FieldResolvers
  req: PayloadRequest
}

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] => {
  return typeof value === 'object' && value !== null
}

const setValueAtPath = (target: any, path: PathSegment[], value: unknown): void => {
  if (path.length === 0) {
    return
  }

  let current = target
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i]
    const nextSegment = path[i + 1]
    const nextValue = current?.[segment]

    if (!isContainer(nextValue)) {
      current[segment] = typeof nextSegment === 'number' ? [] : {}
    }
    current = current[segment]
  }

  current[path[path.length - 1]] = value
}

/**
 * Resolves field values in a deep-cloned document using optional field resolvers.
 *
 * Resolver semantics:
 * - If no resolver exists for a field type, the original value is preserved.
 * - If a resolver returns `undefined`, the value is left unchanged.
 * - Child paths win over parent paths when both resolve values.
 */
export const transformDocument = async (args: TransformDocumentArgs): Promise<any> => {
  const { collection, doc, excludedFields = [], fieldResolvers, req } = args
  const resolvedDoc = structuredClone(doc)
  const patches: ResolvedPatch[] = []
  let visitOrder = 0

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

      const resolver = fieldResolvers?.[field.type]
      if (!resolver) {
        return
      }
      const currentVisitOrder = visitOrder
      visitOrder += 1

      const resolvedValue = await resolver({
        collection,
        doc,
        field: field as never,
        indexPathSegments,
        req,
        schemaMap,
        schemaPathSegments,
        siblingData,
        value,
      })

      if (typeof resolvedValue === 'undefined') {
        return
      }

      patches.push({
        path: indexPathSegments.map((segment) => segment.name),
        value: resolvedValue,
        visitOrder: currentVisitOrder,
      })
    },
    collection,
    doc,
    req,
  })

  // Apply parent-first, then child patches. Child values take precedence.
  patches
    .sort((a, b) => {
      if (a.path.length !== b.path.length) {
        return a.path.length - b.path.length
      }
      return a.visitOrder - b.visitOrder
    })
    .forEach((patch) => {
      setValueAtPath(resolvedDoc, patch.path, patch.value)
    })

  return resolvedDoc
}

import { type CollectionSlug, type Payload } from 'payload'

import type { FieldResolver } from '../resolvers.js'

type RelationshipID = number | string
type ParsedRelationshipValue = {
  collectionSlug?: CollectionSlug
  id?: RelationshipID
  populatedDoc?: Record<string, unknown>
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isRelationshipID = (value: unknown): value is RelationshipID =>
  typeof value === 'number' || typeof value === 'string'

const getIDFromDoc = (value: unknown): RelationshipID | undefined => {
  if (!isObject(value)) {
    return undefined
  }

  return isRelationshipID(value.id) ? value.id : undefined
}

const valueIsValueWithRelation = (
  value: unknown,
): value is { relationTo: CollectionSlug; value: unknown } =>
  isObject(value) &&
  'relationTo' in value &&
  typeof value.relationTo === 'string' &&
  'value' in value

/** Gets the title of a document by its ID */
export const getTitle = async (
  payload: Payload,
  collectionSlug: CollectionSlug,
  documentId: RelationshipID,
) => {
  const collection = payload.collections?.[collectionSlug]
  const useAsTitle = collection?.config?.admin?.useAsTitle

  if (!collection || !useAsTitle) {
    return undefined
  }

  try {
    const doc = await payload.findByID({
      id: documentId,
      collection: collectionSlug,
      select: {
        [useAsTitle]: true,
      },
    })

    if (doc && useAsTitle in doc) {
      return doc[useAsTitle as keyof typeof doc]
    }
  } catch {
    return undefined
  }

  return undefined
}

/** Resolves a relationship field to the title of the referenced document if admin.useAsTitle is set */
export const relationshipTitleResolver: FieldResolver<'relationship'> = async ({
  field,
  req,
  value,
}) => {
  const payload = req.payload
  const relationTo = field.relationTo

  const fallbackCollectionSlug =
    typeof relationTo === 'string'
      ? relationTo
      : relationTo.length === 1
        ? relationTo[0]
        : undefined

  const parseRelationshipValue = (value: unknown): ParsedRelationshipValue => {
    if (isRelationshipID(value)) {
      return { id: value, collectionSlug: fallbackCollectionSlug }
    }

    if (!isObject(value)) {
      return {}
    }

    if (valueIsValueWithRelation(value)) {
      if (isRelationshipID(value.value)) {
        return { id: value.value, collectionSlug: value.relationTo }
      }

      const wrappedID = getIDFromDoc(value.value)
      if (typeof wrappedID !== 'undefined') {
        return {
          id: wrappedID,
          collectionSlug: value.relationTo,
          populatedDoc: value.value as Record<string, unknown>,
        }
      }

      return { collectionSlug: value.relationTo }
    }

    const id = getIDFromDoc(value)
    if (typeof id !== 'undefined') {
      return {
        id,
        collectionSlug: fallbackCollectionSlug,
        populatedDoc: value,
      }
    }

    return {}
  }

  const getTitleFromPopulatedDoc = (
    collectionSlug: CollectionSlug | undefined,
    populatedDoc: Record<string, unknown> | undefined,
  ) => {
    if (!collectionSlug || !populatedDoc) {
      return undefined
    }

    const useAsTitle = payload.collections?.[collectionSlug]?.config?.admin?.useAsTitle

    if (useAsTitle && useAsTitle in populatedDoc) {
      return populatedDoc[useAsTitle]
    }

    return undefined
  }

  const resolveValue = async (rawValue: unknown) => {
    const { id, collectionSlug, populatedDoc } = parseRelationshipValue(rawValue)

    const inlineTitle = getTitleFromPopulatedDoc(collectionSlug, populatedDoc)
    if (typeof inlineTitle !== 'undefined') {
      return inlineTitle
    }

    if (typeof id !== 'undefined' && collectionSlug) {
      const title = await getTitle(payload, collectionSlug, id)
      if (typeof title !== 'undefined') {
        return title
      }
    }

    if (typeof id !== 'undefined') {
      return id
    }

    return rawValue
  }

  let resolvedValue = value
  if (typeof value !== 'undefined' && value !== null) {
    if (Array.isArray(value)) {
      resolvedValue = await Promise.all(value.map(resolveValue))
    } else {
      resolvedValue = await resolveValue(value)
    }
  }

  return resolvedValue
}

import { type CollectionSlug, type Payload } from 'payload'

import type { FieldResolver } from '../resolvers.js'

/** Gets the title of a document by its ID */
export const getTitle = async (
  payload: Payload,
  collectionSlug: CollectionSlug,
  documentId: string,
) => {
  const collection = payload.collections[collectionSlug]
  const useAsTitle = collection.config.admin.useAsTitle
  if (useAsTitle) {
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
  }
  return undefined
}

/** Resolves a relationship field to the title of the referenced document if admin.useAsTitle is set */
export const relationshipTitleResolver: FieldResolver<'relationship'> = async ({
  data,
  field,
  indexPathSegments,
  req,
  schemaPathSegments,
}) => {
  const payload = req.payload
  const relationTo = field.relationTo
  const getCollectionSlugAndId = (
    value: { relationTo: CollectionSlug; value: string } | string,
  ) => {
    if (typeof value === 'object') {
      return { id: value.value, collectionSlug: value.relationTo }
    }
    return { id: value, collectionSlug: relationTo as CollectionSlug }
  }

  let value: any
  if (Array.isArray(data)) {
    value = await Promise.all(
      data.map(async (v) => {
        const { id, collectionSlug } = getCollectionSlugAndId(v)
        const title = await getTitle(payload, collectionSlug, id)
        return title ?? id
      }),
    )
  } else {
    const { id, collectionSlug } = getCollectionSlugAndId(data)
    const title = await getTitle(payload, collectionSlug, id)
    value = title ?? id
  }

  return [
    {
      field,
      indexPathSegments,
      schemaPathSegments,
      value,
    },
  ]
}

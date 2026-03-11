import { type CollectionSlug, type Payload } from 'payload'

import type { FieldResolver } from '../resolvers.js'

/** Gets the file metadata of an upload document by its ID */
export const getFileMetadata = async (
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
        filename: true,
        filesize: true,
        mimeType: true,
        url: true,
      },
    })
    return doc
  }
  return undefined
}

type DocumentValue = { relationTo: CollectionSlug; value: string } | string

/** Resolves an upload field to the file metadata of the referenced document */
export const uploadMetadataResolver: FieldResolver<'upload'> = async ({
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

  const getCollectionSlugAndId = (value: DocumentValue) => {
    if (typeof value === 'object') {
      return { id: value.value, collectionSlug: value.relationTo }
    }
    return { id: value, collectionSlug: fallbackCollectionSlug }
  }

  const resolveValue = async (value: DocumentValue) => {
    const { id, collectionSlug } = getCollectionSlugAndId(value)
    if (!collectionSlug) {
      return id
    }

    const metadata = await getFileMetadata(payload, collectionSlug, id)
    return metadata ?? id
  }

  let resolvedValue = value
  if (value) {
    if (Array.isArray(value)) {
      resolvedValue = await Promise.all(value.map((item) => resolveValue(item as DocumentValue)))
    } else {
      resolvedValue = await resolveValue(value as DocumentValue)
    }
  }

  return resolvedValue
}

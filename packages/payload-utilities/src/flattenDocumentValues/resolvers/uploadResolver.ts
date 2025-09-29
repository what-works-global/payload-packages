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
export const uploadResolver: FieldResolver<'upload'> = async ({
  data,
  field,
  indexPathSegments,
  req,
  schemaPathSegments,
}) => {
  const payload = req.payload
  const relationTo = field.relationTo

  const getCollectionSlugAndId = (value: DocumentValue) => {
    if (typeof value === 'object') {
      return { id: value.value, collectionSlug: value.relationTo }
    }
    return { id: value, collectionSlug: relationTo }
  }

  const resolveValue = async (value: any) => {
    const { id, collectionSlug } = getCollectionSlugAndId(value)
    const metadata = await getFileMetadata(payload, collectionSlug, id)
    return metadata ?? id
  }

  let value: any
  if (Array.isArray(data)) {
    value = await Promise.all(data.map(resolveValue))
  } else {
    value = await resolveValue(data)
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

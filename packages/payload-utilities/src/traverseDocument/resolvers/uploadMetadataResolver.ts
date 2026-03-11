import { type CollectionSlug, type Payload } from 'payload'

import type { FieldResolver } from '../resolvers.js'

type UploadID = number | string
type ParsedUploadValue = {
  collectionSlug?: CollectionSlug
  id?: UploadID
  populatedDoc?: Record<string, unknown>
}

const uploadMetadataFields = ['filename', 'filesize', 'mimeType', 'url'] as const

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isUploadID = (value: unknown): value is UploadID =>
  typeof value === 'number' || typeof value === 'string'

const getIDFromDoc = (value: unknown): undefined | UploadID => {
  if (!isObject(value)) {
    return undefined
  }

  return isUploadID(value.id) ? value.id : undefined
}

const valueIsValueWithRelation = (
  value: unknown,
): value is { relationTo: CollectionSlug; value: unknown } =>
  isObject(value) &&
  'relationTo' in value &&
  typeof value.relationTo === 'string' &&
  'value' in value

/** Gets the file metadata of an upload document by its ID */
export const getFileMetadata = async (
  payload: Payload,
  collectionSlug: CollectionSlug,
  documentId: UploadID,
) => {
  const collection = payload.collections?.[collectionSlug]
  if (!collection) {
    return undefined
  }

  const useAsTitle = collection.config.admin.useAsTitle
  if (useAsTitle) {
    try {
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
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Resolves an upload field to the file metadata of the referenced document */
export const uploadMetadataResolver: FieldResolver<'upload'> = async ({ field, req, value }) => {
  const payload = req.payload
  const relationTo = field.relationTo
  const fallbackCollectionSlug =
    typeof relationTo === 'string'
      ? relationTo
      : relationTo.length === 1
        ? relationTo[0]
        : undefined

  const parseUploadValue = (value: unknown): ParsedUploadValue => {
    if (isUploadID(value)) {
      return { id: value, collectionSlug: fallbackCollectionSlug }
    }

    if (!isObject(value)) {
      return {}
    }

    if (valueIsValueWithRelation(value)) {
      if (isUploadID(value.value)) {
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

  const getMetadataFromPopulatedDoc = (
    populatedDoc: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (!populatedDoc) {
      return undefined
    }

    const metadata: Record<string, unknown> = {}
    let hasMetadataField = false

    for (const metadataField of uploadMetadataFields) {
      if (metadataField in populatedDoc) {
        metadata[metadataField] = populatedDoc[metadataField]
        hasMetadataField = true
      }
    }

    if (isUploadID(populatedDoc.id)) {
      metadata.id = populatedDoc.id
    }

    return hasMetadataField ? metadata : undefined
  }

  const metadataIsComplete = (metadata: Record<string, unknown>) =>
    uploadMetadataFields.every((fieldName) => fieldName in metadata)

  const resolveValue = async (rawValue: unknown) => {
    const { id, collectionSlug, populatedDoc } = parseUploadValue(rawValue)
    const inlineMetadata = getMetadataFromPopulatedDoc(populatedDoc)

    if (inlineMetadata && metadataIsComplete(inlineMetadata)) {
      return inlineMetadata
    }

    if (!collectionSlug) {
      return id
    }

    if (typeof id !== 'undefined') {
      const metadata = await getFileMetadata(payload, collectionSlug, id)
      if (typeof metadata !== 'undefined') {
        return metadata
      }
    }

    if (inlineMetadata) {
      return inlineMetadata
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

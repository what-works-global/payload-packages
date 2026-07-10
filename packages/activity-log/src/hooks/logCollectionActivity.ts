import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  JsonObject,
  PayloadRequest,
  SanitizedCollectionConfig,
} from 'payload'

import type { ActivityHookContext } from './createActivityEntry.js'

import { auditFieldsPluginKey } from '../shared.js'
import { getChangedFields } from '../utilities/getChangedFields.js'
import {
  createActivityEntry,
  isAutosaveRequest,
  resolveEventDocumentLabel,
  resolveEventUser,
  resolveEventUserLabel,
  toSnapshot,
} from './createActivityEntry.js'

/**
 * Field names to leave out of `changedFields`: audit-fields' attribution fields
 * change on every save and carry no signal of their own.
 */
export const getIgnoredChangedFields = (req: PayloadRequest): string[] => {
  const auditConfig = req.payload.config.custom?.[auditFieldsPluginKey] as
    | { createdByFieldName?: null | string; lastModifiedByFieldName?: null | string }
    | undefined
  return [auditConfig?.createdByFieldName, auditConfig?.lastModifiedByFieldName].filter(
    (name): name is string => typeof name === 'string',
  )
}

/**
 * ID of the version written by the current save. Core saves the version before
 * afterChange hooks run (on the same request/transaction), so the latest version
 * for this document is the one this change produced.
 */
const findLatestVersionId = async ({
  collection,
  documentId,
  req,
}: {
  collection: SanitizedCollectionConfig
  documentId: number | string
  req: PayloadRequest
}): Promise<null | number | string> => {
  if (!collection.versions) {
    return null
  }
  try {
    const result = await req.payload.findVersions({
      collection: collection.slug,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      sort: '-updatedAt',
      where: { parent: { equals: documentId } },
    })
    return result.docs[0]?.id ?? null
  } catch {
    return null
  }
}

export const logCollectionAfterChange = (
  context: ActivityHookContext,
): CollectionAfterChangeHook => {
  return async ({ collection, doc, operation: incomingOperation, previousDoc, req }) => {
    if (collection.slug === context.logSlug) {
      return doc
    }
    if (incomingOperation !== 'create' && incomingOperation !== 'update') {
      return doc
    }

    // On trash-enabled collections, moving to / restoring from the trash arrives
    // as an update that flips `deletedAt` — classify it as its own operation.
    let operation: 'create' | 'restore' | 'trash' | 'update' = incomingOperation
    if (operation === 'update' && collection.trash) {
      const wasTrashed = Boolean((previousDoc as JsonObject | undefined)?.deletedAt)
      const isTrashed = Boolean(doc.deletedAt)
      if (isTrashed && !wasTrashed) {
        operation = 'trash'
      } else if (wasTrashed && !isTrashed) {
        operation = 'restore'
      }
    }

    if (!context.events[operation]) {
      return doc
    }
    if (isAutosaveRequest(req) && !context.events.autosave) {
      return doc
    }

    const user = await resolveEventUser({
      collectionSlug: collection.slug,
      context,
      doc,
      operation,
      req,
    })
    if (!user) {
      return doc
    }

    const [userLabel, documentTitle, versionId] = await Promise.all([
      resolveEventUserLabel({ context, ref: user, req }),
      resolveEventDocumentLabel({ collectionSlug: collection.slug, context, doc, req }),
      findLatestVersionId({ collection, documentId: doc.id, req }),
    ])

    await createActivityEntry({
      changedFields:
        operation === 'create'
          ? undefined
          : getChangedFields({
              doc,
              ignore: getIgnoredChangedFields(req),
              previousDoc: previousDoc as JsonObject | undefined,
            }),
      collectionSlug: collection.slug,
      context,
      documentId: doc.id,
      documentTitle,
      operation,
      req,
      snapshot: context.snapshot === 'always' ? toSnapshot(doc) : undefined,
      user,
      userLabel,
      versionId,
    })

    return doc
  }
}

export const logCollectionAfterDelete = (
  context: ActivityHookContext,
): CollectionAfterDeleteHook => {
  return async ({ id, collection, doc, req }) => {
    if (collection.slug === context.logSlug || !context.events.delete) {
      return
    }

    const user = await resolveEventUser({
      collectionSlug: collection.slug,
      context,
      doc,
      operation: 'delete',
      req,
    })
    if (!user) {
      return
    }

    const [userLabel, documentTitle] = await Promise.all([
      resolveEventUserLabel({ context, ref: user, req }),
      resolveEventDocumentLabel({ collectionSlug: collection.slug, context, doc, req }),
    ])

    await createActivityEntry({
      collectionSlug: collection.slug,
      context,
      documentId: id,
      documentTitle,
      operation: 'delete',
      req,
      // A deleted document's versions are deleted with it, so the snapshot is the
      // only surviving record — stored unless snapshots are fully disabled.
      snapshot: context.snapshot === 'never' ? undefined : toSnapshot(doc),
      user,
      userLabel,
    })
  }
}

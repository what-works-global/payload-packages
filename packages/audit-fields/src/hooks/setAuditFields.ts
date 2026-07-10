import type {
  CollectionBeforeChangeHook,
  GlobalBeforeChangeHook,
  JsonObject,
  PayloadRequest,
} from 'payload'

import type { AuditUserRef, ResolveAuditUser } from '../types.js'

export type AuditHookArgs = {
  /** Resolved field name, or `null` when the field is disabled or already owned by the entity. */
  createdByFieldName: null | string
  /** Resolved field name, or `null` when the field is disabled or already owned by the entity. */
  lastModifiedByFieldName: null | string
  resolveUser?: ResolveAuditUser
}

const defaultUserRef = (req: PayloadRequest): AuditUserRef | undefined => {
  if (!req.user) {
    return undefined
  }
  return {
    relationTo: req.user.collection,
    value: req.user.id,
  }
}

const applyAuditFields = async ({
  collectionSlug,
  data,
  globalSlug,
  hookArgs,
  operation,
  originalDoc,
  req,
}: {
  collectionSlug?: string
  data: JsonObject
  globalSlug?: string
  hookArgs: AuditHookArgs
  operation: 'create' | 'update'
  originalDoc?: JsonObject
  req: PayloadRequest
}): Promise<JsonObject> => {
  const { createdByFieldName, lastModifiedByFieldName, resolveUser } = hookArgs

  const ref = resolveUser
    ? await resolveUser({ collectionSlug, data, globalSlug, operation, originalDoc, req })
    : defaultUserRef(req)

  // No attribution available (e.g. system write without a user): leave the fields
  // untouched so scripts and migrations can manage them explicitly.
  if (!ref) {
    return data
  }

  if (operation === 'create') {
    if (createdByFieldName) {
      data[createdByFieldName] = ref
    }
    if (lastModifiedByFieldName) {
      data[lastModifiedByFieldName] = ref
    }
  } else {
    // The creator never changes after the fact. Strip any incoming value so API
    // clients cannot rewrite attribution on update.
    if (createdByFieldName && createdByFieldName in data) {
      delete data[createdByFieldName]
    }
    if (lastModifiedByFieldName) {
      data[lastModifiedByFieldName] = ref
    }
  }

  return data
}

export const setCollectionAuditFields = (hookArgs: AuditHookArgs): CollectionBeforeChangeHook => {
  return async ({ collection, data, operation, originalDoc, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return data
    }
    return applyAuditFields({
      collectionSlug: collection.slug,
      data,
      hookArgs,
      operation,
      originalDoc,
      req,
    })
  }
}

export const setGlobalAuditFields = (hookArgs: AuditHookArgs): GlobalBeforeChangeHook => {
  return async ({ data, global, originalDoc, req }) => {
    // Globals are always saved through "update"; treat the very first save (no
    // persisted document yet) as the create so `createdBy` gets recorded.
    const hasExistingDoc = Boolean(originalDoc && (originalDoc.id ?? originalDoc.createdAt))
    return applyAuditFields({
      data,
      globalSlug: global.slug,
      hookArgs,
      operation: hasExistingDoc ? 'update' : 'create',
      originalDoc,
      req,
    })
  }
}

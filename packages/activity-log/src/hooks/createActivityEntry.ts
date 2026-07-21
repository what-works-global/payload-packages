import type { JsonObject, PayloadRequest } from 'payload'

import type {
  ActivityLogEvents,
  ActivityOperation,
  ActivityUserRef,
  CollectionSnapshotMode,
  GlobalSnapshotMode,
  ResolveActivityDocumentLabel,
  ResolveActivityIpAddress,
  ResolveActivityRequestHost,
  ResolveActivityUser,
  ResolveActivityUserLabel,
} from '../types.js'

import { defaultResolveDocumentLabel, defaultResolveUserLabel } from '../defaults.js'
import { auditFieldsPluginKey } from '../shared.js'
import { pruneActivityLog } from '../utilities/pruneActivityLog.js'

/**
 * Everything the hook factories close over. Resolved once by the plugin and
 * shared by every hook it registers.
 */
export type ActivityHookContext = {
  events: Required<ActivityLogEvents>
  logSlug: string
  resolveDocumentLabel?: ResolveActivityDocumentLabel
  /** Non-null when IP tracking is enabled — applies to every logged operation. */
  resolveIpAddress?: null | ResolveActivityIpAddress
  /** Non-null when host tracking is enabled — applies to every logged operation. */
  resolveRequestHost?: null | ResolveActivityRequestHost
  resolveUser?: ResolveActivityUser
  resolveUserLabel?: ResolveActivityUserLabel
  retention: { maxAgeDays: number } | null
  /**
   * Resolves the effective snapshot mode for a given entity slug — one resolver per
   * scope, since collections and globals can be configured (and defaulted) apart.
   */
  snapshot: {
    collection: (slug: string) => CollectionSnapshotMode
    global: (slug: string) => GlobalSnapshotMode
  }
}

/**
 * Whether a change event (create/update/trash/restore — never a delete) should
 * carry a snapshot: `'always'` always does; `'fallback'` does only when the entity
 * has no versions to fall back on; `'delete'`/`'never'` never do on a change.
 * Globals pass their narrower mode here — it's a subset of the collection modes.
 */
export const shouldSnapshotChange = (mode: CollectionSnapshotMode, hasVersions: boolean): boolean =>
  mode === 'always' || (mode === 'fallback' && !hasVersions)

export const isAutosaveRequest = (req: PayloadRequest): boolean => {
  return Boolean(req.query?.autosave)
}

export const resolveEventUser = async ({
  collectionSlug,
  context,
  doc,
  globalSlug,
  operation,
  req,
}: {
  collectionSlug?: string
  context: ActivityHookContext
  doc?: JsonObject
  globalSlug?: string
  operation: ActivityOperation
  req: PayloadRequest
}): Promise<ActivityUserRef | null> => {
  if (context.resolveUser) {
    const ref = await context.resolveUser({ collectionSlug, doc, globalSlug, operation, req })
    return ref ?? null
  }
  if (!req.user) {
    return null
  }
  return {
    relationTo: req.user.collection,
    value: req.user.id,
  }
}

/**
 * The effective user label resolver: the plugin's own, else the one
 * `@whatworks/payload-audit-fields` stored in `config.custom` (so both plugins
 * display users identically), else the default.
 */
const getUserLabelResolver = (
  context: ActivityHookContext,
  req: PayloadRequest,
): ResolveActivityUserLabel => {
  if (context.resolveUserLabel) {
    return context.resolveUserLabel
  }
  const auditConfig = req.payload.config.custom?.[auditFieldsPluginKey] as
    | { resolveUserLabel?: ResolveActivityUserLabel }
    | undefined
  if (typeof auditConfig?.resolveUserLabel === 'function') {
    return auditConfig.resolveUserLabel
  }
  return defaultResolveUserLabel
}

/**
 * Resolves the label stored for the acting user. When the actor is `req.user`
 * (the common case) no query is needed; a custom-resolved actor (e.g. a bot
 * user) is fetched once at depth 0. Falls back to the raw ID.
 */
export const resolveEventUserLabel = async ({
  context,
  ref,
  req,
  userDoc,
}: {
  context: ActivityHookContext
  ref: ActivityUserRef
  req: PayloadRequest
  /** Pass when the acting user's document is already at hand (login hooks). */
  userDoc?: JsonObject
}): Promise<string> => {
  const resolveUserLabel = getUserLabelResolver(context, req)

  try {
    let doc = userDoc
    if (!doc && req.user && req.user.collection === ref.relationTo && req.user.id === ref.value) {
      doc = req.user as unknown as JsonObject
    }
    if (!doc) {
      doc =
        ((await req.payload.findByID({
          id: ref.value,
          collection: ref.relationTo,
          depth: 0,
          req,
        })) as unknown as JsonObject | null) ?? undefined
    }
    if (doc) {
      const label = await resolveUserLabel({ relationTo: ref.relationTo, req, user: doc })
      if (label) {
        return label
      }
    }
  } catch {
    // Fall through to the raw ID.
  }

  return String(ref.value)
}

export const resolveEventDocumentLabel = async ({
  collectionSlug,
  context,
  doc,
  globalSlug,
  req,
}: {
  collectionSlug?: string
  context: ActivityHookContext
  doc: JsonObject
  globalSlug?: string
  req: PayloadRequest
}): Promise<null | string> => {
  const resolve = context.resolveDocumentLabel ?? defaultResolveDocumentLabel
  try {
    const label = await resolve({ collectionSlug, doc, globalSlug, req })
    if (label) {
      return label
    }
  } catch {
    // Fall through to the ID.
  }
  return doc.id == null ? null : String(doc.id)
}

/**
 * Resolves the IP address stored on the entry. Failures (or a resolver
 * returning nothing) just leave it unset — never block the entry write.
 */
const resolveEventIpAddress = async (
  context: ActivityHookContext,
  req: PayloadRequest,
): Promise<null | string> => {
  if (!context.resolveIpAddress) {
    return null
  }
  try {
    return (await context.resolveIpAddress({ req })) ?? null
  } catch {
    return null
  }
}

/**
 * Resolves the request host stored on the entry. Failures (or a resolver
 * returning nothing) just leave it unset — never block the entry write.
 */
const resolveEventRequestHost = async (
  context: ActivityHookContext,
  req: PayloadRequest,
): Promise<null | string> => {
  if (!context.resolveRequestHost) {
    return null
  }
  try {
    return (await context.resolveRequestHost({ req })) ?? null
  } catch {
    return null
  }
}

/** Plain-JSON copy of a document, safe to store in a json field. */
export const toSnapshot = (doc: JsonObject): JsonObject | null => {
  try {
    return JSON.parse(JSON.stringify(doc)) as JsonObject
  } catch {
    return null
  }
}

export type CreateActivityEntryArgs = {
  changedFields?: string[]
  collectionSlug?: null | string
  context: ActivityHookContext
  documentId?: null | number | string
  documentTitle?: null | string
  globalSlug?: null | string
  operation: ActivityOperation
  req: PayloadRequest
  snapshot?: JsonObject | null
  user: ActivityUserRef
  userLabel: string
  versionId?: null | number | string
}

/**
 * Writes one log entry. Runs on `req` so the entry commits (and rolls back)
 * with the operation that caused it; failures are logged and never break the
 * triggering operation.
 */
export const createActivityEntry = async ({
  changedFields,
  collectionSlug,
  context,
  documentId,
  documentTitle,
  globalSlug,
  operation,
  req,
  snapshot,
  user,
  userLabel,
  versionId,
}: CreateActivityEntryArgs): Promise<void> => {
  try {
    const ipAddress = await resolveEventIpAddress(context, req)
    const requestHost = await resolveEventRequestHost(context, req)

    await req.payload.create({
      collection: context.logSlug,
      data: {
        changedFields: changedFields ?? [],
        collectionSlug: collectionSlug ?? null,
        documentId: documentId == null ? null : String(documentId),
        documentTitle: documentTitle ?? null,
        globalSlug: globalSlug ?? null,
        // Only present when IP tracking is enabled — the field only exists then.
        ...(ipAddress == null ? {} : { ipAddress }),
        // Only present when host tracking is enabled — the field only exists then.
        ...(requestHost == null ? {} : { requestHost }),
        operation,
        snapshot: snapshot ?? undefined,
        user,
        userLabel,
        versionId: versionId == null ? null : String(versionId),
      },
      depth: 0,
      req,
    })

    if (context.retention?.maxAgeDays) {
      // Fire and forget — pruning is throttled internally and must never sit on
      // the request path.
      void pruneActivityLog({
        collectionSlug: context.logSlug,
        maxAgeDays: context.retention.maxAgeDays,
        payload: req.payload,
      })
    }
  } catch (err) {
    req.payload.logger.error({ err, msg: 'activity-log: failed to write log entry' })
  }
}

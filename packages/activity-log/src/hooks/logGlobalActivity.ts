import type { GlobalAfterChangeHook, JsonObject, SanitizedGlobalConfig } from 'payload'

import type { ActivityHookContext } from './createActivityEntry.js'

import { getChangedFields } from '../utilities/getChangedFields.js'
import {
  createActivityEntry,
  isAutosaveRequest,
  resolveEventDocumentLabel,
  resolveEventUser,
  resolveEventUserLabel,
  toSnapshot,
} from './createActivityEntry.js'
import { getIgnoredChangedFields } from './logCollectionActivity.js'

const findLatestGlobalVersionId = async ({
  global,
  req,
}: {
  global: SanitizedGlobalConfig
  req: Parameters<GlobalAfterChangeHook>[0]['req']
}): Promise<null | number | string> => {
  if (!global.versions) {
    return null
  }
  try {
    const result = await req.payload.findGlobalVersions({
      slug: global.slug,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      sort: '-updatedAt',
    })
    return result.docs[0]?.id ?? null
  } catch {
    return null
  }
}

export const logGlobalAfterChange = (context: ActivityHookContext): GlobalAfterChangeHook => {
  return async ({ doc, global, previousDoc, req }) => {
    // Globals are always saved through "update"; treat the very first save (no
    // persisted document yet) as the create.
    const hasExistingDoc = Boolean(previousDoc && (previousDoc.id ?? previousDoc.createdAt))
    const operation = hasExistingDoc ? 'update' : 'create'

    if (!context.events[operation]) {
      return doc
    }
    if (isAutosaveRequest(req) && !context.events.autosave) {
      return doc
    }

    const user = await resolveEventUser({
      context,
      doc,
      globalSlug: global.slug,
      operation,
      req,
    })
    if (!user) {
      return doc
    }

    const [userLabel, documentTitle, versionId] = await Promise.all([
      resolveEventUserLabel({ context, ref: user, req }),
      resolveEventDocumentLabel({ context, doc, globalSlug: global.slug, req }),
      findLatestGlobalVersionId({ global, req }),
    ])

    await createActivityEntry({
      changedFields:
        operation === 'update'
          ? getChangedFields({
              doc,
              ignore: getIgnoredChangedFields(req),
              previousDoc: previousDoc as JsonObject | undefined,
            })
          : undefined,
      context,
      documentTitle,
      globalSlug: global.slug,
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

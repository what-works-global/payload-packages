import type { CollectionAfterLoginHook, CollectionAfterLogoutHook, JsonObject } from 'payload'

import type { ActivityHookContext } from './createActivityEntry.js'

import { createActivityEntry, resolveEventUserLabel } from './createActivityEntry.js'

/**
 * Auth events are attributed directly to the user logging in/out — `resolveUser`
 * does not apply here. The affected "document" is the user's own document, so the
 * feed links to it and the entry shows up when filtering activity for that user.
 */
export const logAfterLogin = (context: ActivityHookContext): CollectionAfterLoginHook => {
  return async ({ collection, req, user }) => {
    if (!context.events.login) {
      return user
    }

    const ref = { relationTo: collection.slug, value: user.id as number | string }
    const userLabel = await resolveEventUserLabel({
      context,
      ref,
      req,
      userDoc: user as unknown as JsonObject,
    })

    await createActivityEntry({
      collectionSlug: collection.slug,
      context,
      documentId: user.id as number | string,
      documentTitle: userLabel,
      operation: 'login',
      req,
      user: ref,
      userLabel,
    })

    return user
  }
}

export const logAfterLogout = (context: ActivityHookContext): CollectionAfterLogoutHook => {
  return async ({ req }) => {
    if (!context.events.logout || !req.user) {
      return
    }

    const ref = { relationTo: req.user.collection, value: req.user.id }
    const userLabel = await resolveEventUserLabel({ context, ref, req })

    await createActivityEntry({
      collectionSlug: req.user.collection,
      context,
      documentId: req.user.id,
      documentTitle: userLabel,
      operation: 'logout',
      req,
      user: ref,
      userLabel,
    })
  }
}

import type { CollectionBeforeChangeHook } from 'payload'

import { APIError } from 'payload'

import { normalizeRoleIds } from './protectRolesField.js'

export type ProtectCredentialsArgs = {
  rolesCollectionSlug: string
  rolesFieldName: string
  /** Names of the `credentialChanges: 'self'` roles (the adminRole always is one). */
  selfOnlyRoleNames: string[]
  /** Slug of the user collection this hook is installed on. */
  userCollectionSlug: string
}

const identityFields = ['email', 'username'] as const

/**
 * Credential guard installed on each user collection: the password, email, and
 * username of a user holding a `credentialChanges: 'self'` role can only be
 * changed by that user — everyone else gets a 403 no matter what permissions
 * they hold, and should send a password-reset email instead. Email and username
 * are locked together with password deliberately: an editable email plus the
 * reset flow would take the account over anyway. Writes without a user (seeds,
 * local API scripts) pass through, matching the other guards.
 */
export const createProtectCredentialsHook = ({
  rolesCollectionSlug,
  rolesFieldName,
  selfOnlyRoleNames,
  userCollectionSlug,
}: ProtectCredentialsArgs): CollectionBeforeChangeHook => {
  const selfOnly = new Set(selfOnlyRoleNames)
  return async ({ data, operation, originalDoc, req }) => {
    if (!req.user || !data || operation !== 'update') {
      return data
    }
    const targetId: unknown = originalDoc?.id
    if (
      req.user.collection === userCollectionSlug &&
      (typeof targetId === 'number' || typeof targetId === 'string') &&
      String(targetId) === String(req.user.id)
    ) {
      return data
    }

    // `data.password` is only deleted after collection beforeChange hooks run,
    // so a password change is visible here; identity fields are compared so a
    // full-document save with an unchanged email still passes.
    const changingPassword = typeof data.password === 'string' && data.password.length > 0
    const changedField = identityFields.find(
      (field) => data[field] != null && data[field] !== originalDoc?.[field],
    )
    if (!changingPassword && !changedField) {
      return data
    }

    const targetRoleIds = normalizeRoleIds(originalDoc?.[rolesFieldName])
    if (targetRoleIds.length === 0) {
      return data
    }
    const { docs } = await req.payload.find({
      collection: rolesCollectionSlug,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      where: { id: { in: targetRoleIds } },
    })
    const protectedRole = docs.find((doc) => typeof doc.name === 'string' && selfOnly.has(doc.name))
    if (!protectedRole) {
      return data
    }

    if (changingPassword) {
      throw new APIError(
        `The password of a user holding the "${String(protectedRole.name)}" role can only be changed by that user — send them a password-reset email instead.`,
        403,
      )
    }
    throw new APIError(
      `The ${changedField} of a user holding the "${String(protectedRole.name)}" role can only be changed by that user.`,
      403,
    )
  }
}

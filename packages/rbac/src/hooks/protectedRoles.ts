import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook } from 'payload'

import { APIError } from 'payload'

import type { PredefinedRole } from '../types.js'

import { samePermissions } from '../permissions.js'

export type ProtectedRolesChangeArgs = {
  protectedRoles: PredefinedRole[]
}

export type ProtectedRolesDeleteArgs = {
  protectedRoleNames: string[]
  rolesCollectionSlug: string
}

/**
 * Locks protected roles to their code definition: they cannot be renamed and their
 * permissions cannot be changed through the API — the only permissions write
 * accepted is restoring the exact code-defined list, so a drifted role can always
 * be repaired but never downgraded. Applies regardless of the caller's own
 * permissions (even `'*'`): the point is that the last full-access role can never
 * be sawed off, leaving nobody able to grant permissions back. Writes without a
 * user (seeding, local API scripts) pass through.
 */
export const createProtectedRolesChangeHook = ({
  protectedRoles,
}: ProtectedRolesChangeArgs): CollectionBeforeChangeHook => {
  const byName = new Map(protectedRoles.map((role) => [role.name, role]))
  return ({ data, originalDoc, req }) => {
    if (!req.user || !data) {
      return data
    }

    const originalName = typeof originalDoc?.name === 'string' ? originalDoc.name : undefined
    const incomingName = typeof data.name === 'string' ? data.name : undefined
    const role = byName.get(originalName ?? '') ?? byName.get(incomingName ?? '')
    if (!role) {
      return data
    }

    if (originalName === role.name && incomingName !== undefined && incomingName !== role.name) {
      throw new APIError(`The role "${role.name}" is protected and cannot be renamed.`, 403)
    }
    if ('permissions' in data && !samePermissions(data.permissions, role.permissions)) {
      throw new APIError(
        `The role "${role.name}" is protected — its permissions are defined in code and cannot be changed here.`,
        403,
      )
    }

    return data
  }
}

/**
 * Blocks deleting protected roles through the API — deleting the only full-access
 * role would lock everyone out just as surely as downgrading it.
 */
export const createProtectedRolesDeleteHook = ({
  protectedRoleNames,
  rolesCollectionSlug,
}: ProtectedRolesDeleteArgs): CollectionBeforeDeleteHook => {
  const names = new Set(protectedRoleNames)
  return async ({ id, req }) => {
    if (!req.user) {
      return
    }
    const doc = (await req.payload.findByID({
      id,
      collection: rolesCollectionSlug,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
      req,
    })) as { name?: unknown } | null
    const name = typeof doc?.name === 'string' ? doc.name : undefined
    if (name !== undefined && names.has(name)) {
      throw new APIError(`The role "${name}" is protected and cannot be deleted.`, 403)
    }
  }
}

import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  PayloadRequest,
} from 'payload'

import { APIError } from 'payload'

import { findRoleIdByName } from '../utilities/roleLookup.js'
import { normalizeRoleIds } from './protectRolesField.js'

export type ProtectLastAdminArgs = {
  adminRoleName: string
  rolesCollectionSlug: string
  rolesFieldName: string
  /** Every collection carrying the roles field — admin holders are counted across all of them. */
  userCollections: string[]
  /** Slug of the user collection this hook is installed on. */
  userCollectionSlug: string
}

const otherAdminUsersExist = async (
  req: PayloadRequest,
  adminRoleId: number | string,
  excludeId: number | string | undefined,
  { rolesFieldName, userCollections, userCollectionSlug }: ProtectLastAdminArgs,
): Promise<boolean> => {
  for (const slug of userCollections) {
    const holdsAdminRole = { [rolesFieldName]: { in: [adminRoleId] } }
    const { totalDocs } = await req.payload.count({
      collection: slug,
      overrideAccess: true,
      req,
      where:
        slug === userCollectionSlug && excludeId !== undefined
          ? { and: [holdsAdminRole, { id: { not_equals: excludeId } }] }
          : holdsAdminRole,
    })
    if (totalDocs > 0) {
      return true
    }
  }
  return false
}

/**
 * Guards the last administrator: removing the admin role from the only user who
 * holds it would strand the system — the escalation guard then blocks everyone
 * from assigning a `'*'` role again. Applies to any authenticated write, including
 * the last admin editing themselves; writes without a user (seeds, init scripts)
 * pass through.
 */
export const createProtectLastAdminChangeHook = (
  args: ProtectLastAdminArgs,
): CollectionBeforeChangeHook => {
  const { adminRoleName, rolesFieldName } = args
  return async ({ data, originalDoc, req }) => {
    if (!req.user || !data || !(rolesFieldName in data)) {
      return data
    }

    const after = new Set(normalizeRoleIds(data[rolesFieldName]).map(String))
    const removedIds = normalizeRoleIds(originalDoc?.[rolesFieldName]).filter(
      (id) => !after.has(String(id)),
    )
    if (removedIds.length === 0) {
      return data
    }

    const adminRoleId = await findRoleIdByName(req, args.rolesCollectionSlug, args.adminRoleName)
    if (adminRoleId === undefined || !removedIds.some((id) => String(id) === String(adminRoleId))) {
      return data
    }

    const excludeId = (originalDoc as { id?: number | string } | undefined)?.id
    if (!(await otherAdminUsersExist(req, adminRoleId, excludeId, args))) {
      throw new APIError(
        `Cannot remove the "${adminRoleName}" role from the last user holding it — at least one administrator must remain.`,
        403,
      )
    }

    return data
  }
}

/**
 * Blocks deleting the last user holding the admin role — the counterpart of the
 * change guard for the delete operation.
 */
export const createProtectLastAdminDeleteHook = (
  args: ProtectLastAdminArgs,
): CollectionBeforeDeleteHook => {
  const { adminRoleName, rolesFieldName, userCollectionSlug } = args
  return async ({ id, req }) => {
    if (!req.user) {
      return
    }

    const doc = (await req.payload.findByID({
      id,
      collection: userCollectionSlug,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
      req,
    })) as null | Record<string, unknown>
    const roleIds = normalizeRoleIds(doc?.[rolesFieldName]).map(String)
    if (roleIds.length === 0) {
      return
    }

    const adminRoleId = await findRoleIdByName(req, args.rolesCollectionSlug, args.adminRoleName)
    if (adminRoleId === undefined || !roleIds.includes(String(adminRoleId))) {
      return
    }

    if (!(await otherAdminUsersExist(req, adminRoleId, id, args))) {
      throw new APIError(
        `Cannot delete the last user holding the "${adminRoleName}" role — at least one administrator must remain.`,
        403,
      )
    }
  }
}

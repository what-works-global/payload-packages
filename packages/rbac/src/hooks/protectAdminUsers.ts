import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  PayloadRequest,
} from 'payload'

import { APIError } from 'payload'

import { findRoleIdByName } from '../utilities/roleLookup.js'
import { normalizeRoleIds } from './protectRolesField.js'

export type ProtectAdminUsersArgs = {
  adminRoleName: string
  rolesCollectionSlug: string
  rolesFieldName: string
  /** Slug of the user collection this hook is installed on. */
  userCollectionSlug: string
}

/** Whether the requesting user holds the admin role themselves. */
const requesterHoldsAdmin = (
  req: PayloadRequest,
  rolesFieldName: string,
  adminRoleId: number | string,
): boolean =>
  normalizeRoleIds((req.user as Record<string, unknown>)[rolesFieldName]).some(
    (id) => String(id) === String(adminRoleId),
  )

/**
 * Protects administrator accounts from users below the admin tier: a user who
 * does not hold the admin role themselves may not create, modify, or delete an
 * account that holds it — even with `users:create`/`users:update`/`users:delete`,
 * even with full access (`'*'`) through another role. Holding the role is the only
 * key, mirroring the holder-only assignment rule, so a `'*'` client can never
 * reach the developer/agency account this guards.
 *
 * The change hook covers create and update; a companion delete hook covers
 * deletion. Adding the admin role to a not-yet-admin account is an *assignment*,
 * governed separately by the holder-only rule in the roles-field guard, so update
 * keys off the account's existing roles — not the incoming ones. Writes without a
 * user (seeds, the first-user bootstrap, break-glass self-claims of an account
 * that does not yet hold the role) pass through, matching the other guards.
 */
export const createProtectAdminUsersChangeHook = ({
  adminRoleName,
  rolesCollectionSlug,
  rolesFieldName,
}: ProtectAdminUsersArgs): CollectionBeforeChangeHook => {
  return async ({ data, operation, originalDoc, req }) => {
    if (!req.user || !data) {
      return data
    }

    // The roles of the account being written: the incoming set for a create (a
    // would-be administrator), the account's existing set for an update. Adding
    // the admin role to a non-admin via update is an assignment vetted by the
    // holder-only rule, so it is deliberately not treated as "modifying an admin".
    const targetRoleIds =
      operation === 'create'
        ? normalizeRoleIds(data[rolesFieldName])
        : normalizeRoleIds(originalDoc?.[rolesFieldName])
    if (targetRoleIds.length === 0) {
      return data
    }

    const adminRoleId = await findRoleIdByName(req, rolesCollectionSlug, adminRoleName)
    if (
      adminRoleId === undefined ||
      !targetRoleIds.some((id) => String(id) === String(adminRoleId))
    ) {
      return data
    }

    if (requesterHoldsAdmin(req, rolesFieldName, adminRoleId)) {
      return data
    }

    throw new APIError(
      operation === 'create'
        ? `Only a user holding the "${adminRoleName}" role can create an account with that role.`
        : `Only a user holding the "${adminRoleName}" role can modify an account that holds it.`,
      403,
    )
  }
}

/**
 * Blocks deleting an account that holds the admin role unless the requester holds
 * it too — the delete counterpart of the change guard. Stricter than the
 * last-administrator guard, which only protects the final holder: here a
 * non-administrator cannot delete *any* administrator.
 */
export const createProtectAdminUsersDeleteHook = ({
  adminRoleName,
  rolesCollectionSlug,
  rolesFieldName,
  userCollectionSlug,
}: ProtectAdminUsersArgs): CollectionBeforeDeleteHook => {
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
    const targetRoleIds = normalizeRoleIds(doc?.[rolesFieldName])
    if (targetRoleIds.length === 0) {
      return
    }

    const adminRoleId = await findRoleIdByName(req, rolesCollectionSlug, adminRoleName)
    if (
      adminRoleId === undefined ||
      !targetRoleIds.some((roleId) => String(roleId) === String(adminRoleId))
    ) {
      return
    }

    if (requesterHoldsAdmin(req, rolesFieldName, adminRoleId)) {
      return
    }

    throw new APIError(
      `Only a user holding the "${adminRoleName}" role can delete an account that holds it.`,
      403,
    )
  }
}

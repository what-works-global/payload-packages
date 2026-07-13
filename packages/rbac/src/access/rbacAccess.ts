import type { Access } from 'payload'

import type { RbacAction } from '../shared.js'

import { permissionCovers, permissionsGrant } from '../permissions.js'
import { getUserPermissions } from '../utilities/getUserPermissions.js'

export type CreateRbacAccessArgs = {
  action: RbacAction
  /**
   * Actions the requesting user is allowed on their own user document even without
   * the collection permission. Only relevant on auth collections; grants a
   * `{ id: { equals: user.id } }` query constraint.
   */
  ownAccountActions?: readonly RbacAction[]
  slug: string
}

/**
 * Builds the access function the plugin installs for one operation on one
 * collection or global: deny anonymous requests, allow when any of the user's
 * roles grants the permission (or `'*'`), otherwise constrain to the user's own
 * document when the own-account carve-out applies.
 */
export const createRbacAccess = ({
  slug,
  action,
  ownAccountActions = [],
}: CreateRbacAccessArgs): Access => {
  return async ({ req }) => {
    const { user } = req
    if (!user) {
      return false
    }

    const permissions = await getUserPermissions(req)
    if (permissionsGrant(permissions, slug, action)) {
      return true
    }

    if (ownAccountActions.includes(action) && user.collection === slug) {
      return { id: { equals: user.id } }
    }

    return false
  }
}

/**
 * Access factory for composing role checks into your own access control, e.g.
 * `access: { update: requirePermission('posts:update') }`.
 */
export const requirePermission = (permission: string): Access => {
  return async ({ req }) => {
    if (!req.user) {
      return false
    }
    const permissions = await getUserPermissions(req)
    return permissionCovers(permissions, permission)
  }
}

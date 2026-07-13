import type { FieldAccess } from 'payload'

import { permissionFor } from '../permissions.js'
import { anyUserHoldsRole, findFullAccessRoleIds } from '../utilities/fullAccessHolders.js'
import { hasPermission } from '../utilities/getUserPermissions.js'

export type CreateRolesFieldAccessArgs = {
  /**
   * Keep the field writable while no user in the system holds full access, so a
   * stranded user can still claim the admin role from their own account page.
   * Set only when an `adminRole` exists — without one there is no break-glass
   * path to hold open.
   */
  breakGlass?: {
    userCollections: string[]
  }
  rolesCollectionSlug: string
  rolesFieldName: string
}

/**
 * Field-level access for the roles field on user collections: changing role
 * membership requires the `<roles>:update` permission. Field access is what
 * makes the admin panel render the field read-only, so a user without it can
 * never accidentally remove their own roles; API writes that include the field
 * without the permission succeed with the field silently kept unchanged —
 * Payload's field-access semantics. Writes without a user (seeds, init scripts,
 * the first-user registration) pass through, like the guard hooks.
 */
export const createRolesFieldAccess = ({
  breakGlass,
  rolesCollectionSlug,
  rolesFieldName,
}: CreateRolesFieldAccessArgs): FieldAccess => {
  const requiredPermission = permissionFor(rolesCollectionSlug, 'update')
  return async ({ req }) => {
    if (!req.user) {
      return true
    }
    if (await hasPermission(req, requiredPermission)) {
      return true
    }
    if (!breakGlass) {
      return false
    }
    // Break-glass: while nobody holds full access the field must stay writable,
    // or the stranded self-claim would be stripped from the write before the
    // escalation guard — which still limits what that write may do — saw it.
    const fullAccessRoleIds = await findFullAccessRoleIds(req.payload, rolesCollectionSlug)
    return !(await anyUserHoldsRole(req.payload, fullAccessRoleIds, {
      rolesFieldName,
      userCollections: breakGlass.userCollections,
    }))
  }
}

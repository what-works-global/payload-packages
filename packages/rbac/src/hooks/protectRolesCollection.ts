import type { CollectionBeforeChangeHook } from 'payload'

import { APIError } from 'payload'

import { missingPermissions } from '../permissions.js'
import { getUserPermissions } from '../utilities/getUserPermissions.js'

export type ProtectRolesCollectionArgs = {
  /**
   * Roles locked to their code definition. The escalation check is skipped for
   * them: the protected-role guard (which runs first) only lets through writes
   * that exactly restore the code-defined permissions, and that restore must stay
   * possible even when nobody holds the drifted-away permissions anymore.
   */
  protectedRoleNames?: string[]
}

/**
 * Privilege-escalation guard installed on the roles collection: a user editing or
 * creating a role may only add permissions their own roles already cover — without
 * this, anyone with update access on the roles collection could widen their own
 * role to full access. Users with `'*'` may grant anything; writes without a user
 * pass through.
 */
export const createProtectRolesCollectionHook = ({
  protectedRoleNames = [],
}: ProtectRolesCollectionArgs = {}): CollectionBeforeChangeHook => {
  const protectedNames = new Set(protectedRoleNames)
  return async ({ data, originalDoc, req }) => {
    if (!req.user || !data || !('permissions' in data)) {
      return data
    }

    const name =
      typeof originalDoc?.name === 'string'
        ? originalDoc.name
        : typeof data.name === 'string'
          ? data.name
          : undefined
    if (name !== undefined && protectedNames.has(name)) {
      return data
    }

    const previous = new Set<string>(
      Array.isArray(originalDoc?.permissions) ? originalDoc.permissions : [],
    )
    const added = (Array.isArray(data.permissions) ? data.permissions : []).filter(
      (permission): permission is string =>
        typeof permission === 'string' && !previous.has(permission),
    )
    if (added.length === 0) {
      return data
    }

    const granted = await getUserPermissions(req)
    const missing = missingPermissions(granted, added)
    if (missing.length > 0) {
      throw new APIError(`You cannot grant permissions you do not hold: ${missing.join(', ')}`, 403)
    }

    return data
  }
}

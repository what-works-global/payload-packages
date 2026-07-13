import type { CollectionBeforeChangeHook } from 'payload'

import { APIError } from 'payload'

import { missingPermissions } from '../permissions.js'
import { anyUserHoldsRole, findFullAccessRoleIds } from '../utilities/fullAccessHolders.js'
import { getUserPermissions } from '../utilities/getUserPermissions.js'

/** Extracts the role IDs from a relationship value (IDs or populated documents). */
export const normalizeRoleIds = (value: unknown): (number | string)[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const ids: (number | string)[] = []
  for (const entry of value) {
    if (typeof entry === 'number' || typeof entry === 'string') {
      ids.push(entry)
    } else if (entry && typeof entry === 'object') {
      const id = (entry as Record<string, unknown>).id
      if (typeof id === 'number' || typeof id === 'string') {
        ids.push(id)
      }
    }
  }
  return ids
}

export type ProtectRolesFieldArgs = {
  /**
   * Break-glass recovery for the named admin role: while no user in the system
   * holds full access, a user may assign this role to themselves. Without it, a
   * system whose administrators were lost to database-level damage could never
   * regain one through the API.
   */
  breakGlass?: {
    adminRoleName: string
    userCollections: string[]
  }
  /**
   * Roles that only their holders may assign — permissions covering the role
   * (even `'*'`) are not enough. The restriction relaxes while no user holds the
   * role at all, so a newly introduced or renamed role can still be claimed by a
   * user passing the ordinary permission check.
   */
  holderOnly?: {
    roleNames: string[]
    userCollections: string[]
  }
  /**
   * Apply the permission-coverage check. The plugin disables this when
   * `preventPrivilegeEscalation` is off while `holderOnly` must still apply.
   *
   * @default true
   */
  preventEscalation?: boolean
  rolesCollectionSlug: string
  rolesFieldName: string
}

/**
 * Privilege-escalation guard installed on each user collection: a user may only
 * assign roles whose permissions their own roles already cover (users with `'*'`
 * may assign anything), and `holderOnly` roles — the admin role — additionally
 * only by users who already hold them. Removals mirror additions on the user's
 * own account: a role may only be removed from yourself when the roles you keep
 * still cover its permissions — otherwise you could never assign it back and
 * would have locked yourself out. Removing roles from other users is not
 * restricted, and writes without a user — seeds, init scripts, first-user
 * registration — pass through.
 */
export const createProtectRolesFieldHook = ({
  breakGlass,
  holderOnly,
  preventEscalation,
  rolesCollectionSlug,
  rolesFieldName,
}: ProtectRolesFieldArgs): CollectionBeforeChangeHook => {
  const holderOnlyNames = new Set(holderOnly?.roleNames ?? [])
  return async ({ collection, data, originalDoc, req }) => {
    if (!req.user || !data || !(rolesFieldName in data)) {
      return data
    }

    const previousIds = normalizeRoleIds(originalDoc?.[rolesFieldName])
    const previousIdSet = new Set(previousIds.map(String))
    const nextIdSet = new Set(normalizeRoleIds(data[rolesFieldName]).map(String))
    const addedIds = normalizeRoleIds(data[rolesFieldName]).filter(
      (id) => !previousIdSet.has(String(id)),
    )

    const targetId: unknown = originalDoc?.id
    const isSelf =
      req.user.collection === collection.slug &&
      (typeof targetId === 'number' || typeof targetId === 'string') &&
      String(targetId) === String(req.user.id)
    const removedIds =
      isSelf && preventEscalation !== false
        ? previousIds.filter((id) => !nextIdSet.has(String(id)))
        : []

    if (addedIds.length === 0 && removedIds.length === 0) {
      return data
    }

    let stranded: boolean | undefined
    const systemIsStranded = async (): Promise<boolean> => {
      if (stranded === undefined) {
        const fullAccessRoleIds = await findFullAccessRoleIds(req.payload, rolesCollectionSlug)
        stranded = !(await anyUserHoldsRole(req.payload, fullAccessRoleIds, {
          rolesFieldName,
          userCollections: breakGlass?.userCollections ?? [],
        }))
      }
      return stranded
    }

    if (addedIds.length > 0) {
      const granted =
        preventEscalation === false ? new Set<string>() : await getUserPermissions(req)
      const heldRoleIds = new Set(
        normalizeRoleIds((req.user as Record<string, unknown>)[rolesFieldName]).map(String),
      )

      const { docs: addedRoles } = await req.payload.find({
        collection: rolesCollectionSlug,
        depth: 0,
        overrideAccess: true,
        pagination: false,
        req,
        where: { id: { in: addedIds } },
      })

      for (const role of addedRoles) {
        const required = Array.isArray(role.permissions)
          ? role.permissions.filter((p): p is string => typeof p === 'string')
          : []
        const missing = preventEscalation === false ? [] : missingPermissions(granted, required)

        let missingHolder = false
        if (
          typeof role.name === 'string' &&
          holderOnlyNames.has(role.name) &&
          !heldRoleIds.has(String(role.id))
        ) {
          // Only holders may hand out a holder-only role — except while nobody
          // holds it at all (a fresh rename, or the plugin newly added to an
          // existing project), when a user passing the permission check steps up.
          missingHolder = await anyUserHoldsRole(req.payload, [role.id], {
            rolesFieldName,
            userCollections: holderOnly?.userCollections ?? [],
          })
        }

        if (missing.length === 0 && !missingHolder) {
          continue
        }

        if (
          breakGlass &&
          role.name === breakGlass.adminRoleName &&
          isSelf &&
          (await systemIsStranded())
        ) {
          continue
        }
        if (missingHolder) {
          throw new APIError(
            `The role "${String(role.name)}" can only be assigned by a user who holds it.`,
            403,
          )
        }
        throw new APIError(
          `You cannot assign the role "${String(role.name)}" — it grants permissions you do not hold: ${missing.join(', ')}`,
          403,
        )
      }
    }

    if (removedIds.length > 0) {
      // Removals mirror additions on your own account: the roles you keep must
      // cover what the removed role granted, or the escalation guard could never
      // let you re-assign it — one save away from locking yourself out. Roles
      // whose documents no longer exist grant nothing and may always be removed.
      const { docs: previousRoles } = await req.payload.find({
        collection: rolesCollectionSlug,
        depth: 0,
        overrideAccess: true,
        pagination: false,
        req,
        where: { id: { in: previousIds } },
      })
      const keptPermissions = new Set(
        previousRoles
          .filter((role) => nextIdSet.has(String(role.id)))
          .flatMap((role) =>
            Array.isArray(role.permissions)
              ? role.permissions.filter((p): p is string => typeof p === 'string')
              : [],
          ),
      )
      for (const role of previousRoles) {
        if (nextIdSet.has(String(role.id))) {
          continue
        }
        const required = Array.isArray(role.permissions)
          ? role.permissions.filter((p): p is string => typeof p === 'string')
          : []
        const missing = missingPermissions(keptPermissions, required)
        if (missing.length > 0) {
          throw new APIError(
            `You cannot remove the role "${String(role.name)}" from your own account — the roles you would keep do not cover ${missing.join(', ')}, so you could not assign it back. Another user with role management access must remove it.`,
            403,
          )
        }
      }
    }

    return data
  }
}

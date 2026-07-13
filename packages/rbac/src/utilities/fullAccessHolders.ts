import type { Payload } from 'payload'

import { FULL_ACCESS } from '../permissions.js'

export type RoleHolderQueryArgs = {
  rolesFieldName: string
  /** Every collection carrying the roles field — holders are counted across all of them. */
  userCollections: string[]
}

/** IDs of every role that grants full access (`'*'`). */
export const findFullAccessRoleIds = async (
  payload: Payload,
  rolesCollectionSlug: string,
): Promise<(number | string)[]> => {
  const { docs } = await payload.find({
    collection: rolesCollectionSlug,
    depth: 0,
    pagination: false,
  })
  return docs
    .filter((doc) => {
      const permissions = (doc as { permissions?: unknown }).permissions
      return Array.isArray(permissions) && permissions.includes(FULL_ACCESS)
    })
    .map((doc) => (doc as { id: number | string }).id)
}

/** Whether any user across the user collections holds one of the given roles. */
export const anyUserHoldsRole = async (
  payload: Payload,
  roleIds: (number | string)[],
  { rolesFieldName, userCollections }: RoleHolderQueryArgs,
): Promise<boolean> => {
  if (roleIds.length === 0) {
    return false
  }
  for (const slug of userCollections) {
    const { totalDocs } = await payload.count({
      collection: slug,
      where: { [rolesFieldName]: { in: roleIds } },
    })
    if (totalDocs > 0) {
      return true
    }
  }
  return false
}

export type WarnIfAdminRoleUnheldArgs = {
  adminRoleName: string
  rolesCollectionSlug: string
} & RoleHolderQueryArgs

/**
 * Init-time check, run after seeding: logs how to recover when no user holds the
 * admin role. The guards prevent reaching this state through the API; it arises
 * from what they cannot see — the roles collection wiped at the database level
 * (re-seeded roles get new IDs, so users' role references dangle) or a renamed
 * `adminRole` (a fresh role seeded under the new name with no holders). Silent
 * when there are no users at all: the first-user bootstrap covers that.
 */
export const warnIfAdminRoleUnheld = async (
  payload: Payload,
  {
    adminRoleName,
    rolesCollectionSlug,
    rolesFieldName,
    userCollections,
  }: WarnIfAdminRoleUnheldArgs,
): Promise<void> => {
  const { docs } = await payload.find({
    collection: rolesCollectionSlug,
    depth: 0,
    limit: 1,
    where: { name: { equals: adminRoleName } },
  })
  const adminRoleId = (docs[0] as { id?: number | string } | undefined)?.id
  if (adminRoleId === undefined) {
    return
  }

  const holderArgs = { rolesFieldName, userCollections }
  if (await anyUserHoldsRole(payload, [adminRoleId], holderArgs)) {
    return
  }

  let usersExist = false
  for (const slug of userCollections) {
    const { totalDocs } = await payload.count({ collection: slug })
    if (totalDocs > 0) {
      usersExist = true
      break
    }
  }
  if (!usersExist) {
    return
  }

  const fullAccessRoleIds = await findFullAccessRoleIds(payload, rolesCollectionSlug)
  const otherFullAccessRoleIds = fullAccessRoleIds.filter(
    (id) => String(id) !== String(adminRoleId),
  )
  if (await anyUserHoldsRole(payload, otherFullAccessRoleIds, holderArgs)) {
    payload.logger.warn(
      `[payload-rbac] No user holds the "${adminRoleName}" role. A user with full access through another role can assign it in the admin panel.`,
    )
    return
  }
  payload.logger.warn(
    `[payload-rbac] No user holds the "${adminRoleName}" role and no user has full access. Any signed-in user may assign "${adminRoleName}" to themselves from their account page — the escalation guard permits this while no administrator exists.`,
  )
}

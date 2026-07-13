import type { CollectionBeforeChangeHook } from 'payload'

export type AssignFirstUserRoleArgs = {
  firstUserRole: string
  rolesCollectionSlug: string
  rolesFieldName: string
}

/**
 * Bootstrap hook installed on the admin user collection: when the very first user
 * is created without roles by an unauthenticated request — the admin "create first
 * user" screen or an init seed — assign the configured role so a fresh project
 * starts with a usable admin account.
 */
export const createAssignFirstUserRoleHook = ({
  firstUserRole,
  rolesCollectionSlug,
  rolesFieldName,
}: AssignFirstUserRoleArgs): CollectionBeforeChangeHook => {
  return async ({ collection, data, operation, req }) => {
    if (operation !== 'create' || req.user || !data) {
      return data
    }

    const existingRoles = data[rolesFieldName]
    if (Array.isArray(existingRoles) && existingRoles.length > 0) {
      return data
    }

    const { totalDocs } = await req.payload.count({ collection: collection.slug, req })
    if (totalDocs > 0) {
      return data
    }

    const { docs } = await req.payload.find({
      collection: rolesCollectionSlug,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { name: { equals: firstUserRole } },
    })
    const role = docs[0]
    if (!role) {
      req.payload.logger.warn(
        `[payload-rbac] firstUserRole "${firstUserRole}" not found — first user created without roles`,
      )
      return data
    }

    return { ...data, [rolesFieldName]: [role.id] }
  }
}

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

    // Existence check via `find` with `pagination: false` — deliberately NOT
    // `count`. An unfiltered `count` uses Mongo's `count` command (through
    // `estimatedDocumentCount`), which is rejected inside a multi-document
    // transaction ("Cannot run 'count' in a multi-document transaction"). This
    // hook runs precisely inside one whenever the first user is seeded by a
    // transactional `create` on a replica set (Atlas) — e.g. an init/build
    // `onInit` seed — so a `count` here fails the whole boot. `find` with
    // `pagination: false` skips the count entirely and works with or without an
    // active transaction.
    const { docs: existingUsers } = await req.payload.find({
      collection: collection.slug,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
      req,
    })
    if (existingUsers.length > 0) {
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

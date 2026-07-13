import type { Payload } from 'payload'

import type { PredefinedRole } from './types.js'

import { samePermissions } from './permissions.js'

export type SeedPredefinedRolesArgs = {
  roles: PredefinedRole[]
  rolesCollectionSlug: string
}

/**
 * Creates each predefined role that does not exist yet, keyed by `name`. Existing
 * roles are never updated or overwritten — the database is the source of truth once
 * a role exists, so admin edits survive restarts — except `protected` roles, where
 * code is the source of truth: drifted permissions are restored on every init, so a
 * protected full-access role recovers even from direct database edits. Runs in
 * `onInit` before any `onInit` defined on the config, so init seeds can rely on the
 * roles being present.
 */
export const seedPredefinedRoles = async (
  payload: Payload,
  { roles, rolesCollectionSlug }: SeedPredefinedRolesArgs,
): Promise<void> => {
  for (const role of roles) {
    const existing = await payload.find({
      collection: rolesCollectionSlug,
      depth: 0,
      limit: 1,
      where: { name: { equals: role.name } },
    })
    const existingDoc = existing.docs[0] as
      | { id: number | string; permissions?: unknown }
      | undefined
    if (existingDoc) {
      if (role.protected && !samePermissions(existingDoc.permissions, role.permissions)) {
        await payload.update({
          id: existingDoc.id,
          collection: rolesCollectionSlug,
          data: { permissions: role.permissions },
          depth: 0,
        })
        payload.logger.info(`[payload-rbac] Restored permissions of protected role "${role.name}"`)
      }
      continue
    }

    await payload.create({
      collection: rolesCollectionSlug,
      data: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      },
    })
    payload.logger.info(`[payload-rbac] Seeded role "${role.name}"`)
  }
}

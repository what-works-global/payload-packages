import type { Payload } from 'payload'

import type { PredefinedRole } from './types.js'

import { samePermissions } from './permissions.js'
import { ensureRolesIndexes } from './utilities/ensureRolesIndexes.js'
import { isUniqueViolation } from './utilities/isUniqueViolation.js'
import { retryOnWriteConflict } from './utilities/retryOnWriteConflict.js'

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
  // Guarantee the unique constraint on `name` is enforced before the first
  // `create`, so a concurrent-boot race can't slip duplicate roles past the
  // non-atomic find-then-create below. See `ensureRolesIndexes` for why this is
  // only needed (and only possible) on MongoDB.
  await ensureRolesIndexes(payload, rolesCollectionSlug)

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
        await retryOnWriteConflict(() =>
          payload.update({
            id: existingDoc.id,
            collection: rolesCollectionSlug,
            data: { permissions: role.permissions },
            depth: 0,
          }),
        )
        payload.logger.info(`[payload-rbac] Restored permissions of protected role "${role.name}"`)
      }
      continue
    }

    try {
      // First boot only: the roles collection's unique `name` index is still
      // being built (see `ensureRolesIndexes`), and a transactional create
      // against a collection with an in-progress index build is aborted with a
      // transient `WriteConflict`. Retry it. A retry that then loses to another
      // writer surfaces as the unique-violation handled below, not a conflict.
      await retryOnWriteConflict(() =>
        payload.create({
          collection: rolesCollectionSlug,
          data: {
            name: role.name,
            description: role.description,
            permissions: role.permissions,
          },
        }),
      )
      payload.logger.info(`[payload-rbac] Seeded role "${role.name}"`)
    } catch (error) {
      // `onInit` runs on every serverless cold boot, so several instances can
      // seed concurrently: each `find` above returns nothing, then each tries
      // to `create` the same role. The unique constraint on `name` makes all
      // but one create fail with a unique-violation — treat that as "already
      // seeded" so a boot race can't crash init or leave duplicate docs.
      if (isUniqueViolation(error)) {
        payload.logger.info(
          `[payload-rbac] Role "${role.name}" already created concurrently — skipping`,
        )
        continue
      }
      throw error
    }
  }
}

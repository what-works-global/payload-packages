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

type ExistingRole = { id: number | string; permissions?: unknown }

const findRoleByName = async (
  payload: Payload,
  rolesCollectionSlug: string,
  name: string,
): Promise<ExistingRole | undefined> => {
  const result = await payload.find({
    collection: rolesCollectionSlug,
    depth: 0,
    limit: 1,
    where: { name: { equals: name } },
  })
  return result.docs[0] as ExistingRole | undefined
}

/**
 * Creates each predefined role that does not exist yet, keyed by `name`. Existing
 * roles are never updated or overwritten — the database is the source of truth once
 * a role exists, so admin edits survive restarts — except `protected` roles, where
 * code is the source of truth: drifted permissions are restored on every init, so a
 * protected full-access role recovers even from direct database edits. Runs in
 * `onInit` before any `onInit` defined on the config, so init seeds can rely on the
 * roles being present.
 *
 * `onInit` runs on every cold boot, and `next build` collects page data across
 * several worker processes at once, so many instances can seed the same fresh
 * database concurrently. Two things make that safe: the unique index on `name`
 * (see `ensureRolesIndexes`) turns a lost create race into a duplicate-key error,
 * and every write runs with `disableTransaction: true`. The latter matters
 * because on a replica set (Atlas) Payload otherwise wraps each write in a
 * transaction, and a transactional write against a not-yet-created collection is
 * aborted with a transient `WriteConflict` (112) or, when it must create the
 * collection itself, `OperationNotSupportedInTransaction` (263) — which can fail
 * every concurrent boot at once and leave the build with no seeded roles. Seeding
 * is a set of independent single-document inserts that need no atomic guarantee,
 * so dropping the transaction is safe and removes the whole class of failure.
 */
export const seedPredefinedRoles = async (
  payload: Payload,
  { roles, rolesCollectionSlug }: SeedPredefinedRolesArgs,
): Promise<void> => {
  // Force the unique index on `name` to exist before the first create, so a
  // concurrent-boot race resolves to a duplicate-key error (handled below)
  // rather than duplicate role documents. Best-effort — see `ensureRolesIndexes`.
  await ensureRolesIndexes(payload, rolesCollectionSlug)

  for (const role of roles) {
    const existingDoc = await findRoleByName(payload, rolesCollectionSlug, role.name)
    if (existingDoc) {
      if (role.protected && !samePermissions(existingDoc.permissions, role.permissions)) {
        await retryOnWriteConflict(() =>
          payload.update({
            id: existingDoc.id,
            collection: rolesCollectionSlug,
            data: { permissions: role.permissions },
            depth: 0,
            disableTransaction: true,
          }),
        )
        payload.logger.info(`[payload-rbac] Restored permissions of protected role "${role.name}"`)
      }
      continue
    }

    try {
      // `retryOnWriteConflict` still covers a non-transactional write racing the
      // background index build; `disableTransaction` (see the function docstring)
      // covers the transaction-abort failures on a fresh replica-set database.
      await retryOnWriteConflict(() =>
        payload.create({
          collection: rolesCollectionSlug,
          data: {
            name: role.name,
            description: role.description,
            permissions: role.permissions,
          },
          disableTransaction: true,
        }),
      )
      payload.logger.info(`[payload-rbac] Seeded role "${role.name}"`)
    } catch (error) {
      // A concurrent boot may have created this role between our find and create.
      // The failure is not always recognizable from the error object — Payload's
      // mongoose adapter rewraps Mongo's duplicate-key (11000) into a
      // `ValidationError` that drops the code — so instead of matching error
      // shapes we confirm the postcondition: if the role now exists, another boot
      // won the race and we continue; otherwise the failure is real and rethrows.
      const alreadySeeded =
        isUniqueViolation(error) ||
        Boolean(await findRoleByName(payload, rolesCollectionSlug, role.name))
      if (alreadySeeded) {
        payload.logger.info(
          `[payload-rbac] Role "${role.name}" already created concurrently — skipping`,
        )
        continue
      }
      throw error
    }
  }
}

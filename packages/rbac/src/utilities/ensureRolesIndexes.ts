import type { Payload } from 'payload'

import { isUniqueViolation } from './isUniqueViolation.js'
import { isTransientMongoError, retryOnWriteConflict } from './retryOnWriteConflict.js'

/**
 * Builds the roles collection's indexes on MongoDB before seeding runs.
 *
 * On SQL adapters the `unique` constraint on `name` is part of the table DDL
 * and applied through the consumer's normal migration workflow, so it is
 * enforced from the moment the table exists — nothing to do here. MongoDB is
 * different: indexes are runtime artifacts, `mongoose`'s `autoIndex` builds
 * them in the background (non-blocking) and the adapter's `ensureIndexes`
 * option defaults to off — neither of which we can rely on from inside a
 * plugin. Without an enforced unique index, two concurrent `onInit` cold boots
 * can both `find` → empty → both `create` and produce duplicate roles.
 *
 * So on Mongo we force the build ourselves, before any seed `create`, so the
 * unique constraint on `name` is live by the time the first role is written.
 * The build only fails when the collection *already* holds duplicate names —
 * which no code should silently delete — so that case logs a clear pointer to
 * manual cleanup instead of throwing (a throw would break every boot).
 */
export const ensureRolesIndexes = async (
  payload: Payload,
  rolesCollectionSlug: string,
): Promise<void> => {
  // Only the mongoose adapter needs (and exposes) a runtime index build.
  if (payload.db.name !== 'mongoose') {
    return
  }

  const model = (
    payload.db as unknown as {
      collections?: Record<string, { createIndexes?: () => Promise<unknown> }>
    }
  ).collections?.[rolesCollectionSlug]

  // `.bind(model)` matters: `createIndexes` is a mongoose model method that
  // needs `this` to be the model, so it must not be called as a bare function.
  const createIndexes = model?.createIndexes?.bind(model)
  if (!createIndexes) {
    return
  }

  try {
    // Idempotent: creates any missing indexes (including the unique `name`
    // index) and is a no-op once they exist. Building it is a best effort, so
    // retry the full transient class — not just `WriteConflict` but also the
    // write-concern/step-down churn ("operation was interrupted") that many
    // concurrent `onInit` boots provoke on a fresh replica set — because a
    // `create` racing an in-progress index build is what the unique index is
    // there to make safe in the first place.
    await retryOnWriteConflict(() => createIndexes(), { shouldRetry: isTransientMongoError })
  } catch (error) {
    if (isUniqueViolation(error)) {
      payload.logger.error(
        `[payload-rbac] Could not build the unique index on "${rolesCollectionSlug}.name" ` +
          `because the collection already contains duplicate role names. Remove the ` +
          `duplicates, then restart so the constraint can be enforced.`,
      )
      return
    }
    throw error
  }
}

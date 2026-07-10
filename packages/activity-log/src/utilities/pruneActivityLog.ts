import type { Payload } from 'payload'

const PRUNE_INTERVAL_MS = 60 * 60 * 1000

let lastPruneAt = 0

/** Test-only: allow the throttle to fire again. */
export const resetPruneThrottle = (): void => {
  lastPruneAt = 0
}

/**
 * Deletes log entries older than the retention window. Called (not awaited) after
 * log writes and throttled to once per hour per process, so pruning never sits on
 * the request path. Uses the db adapter directly — the log collection has no
 * hooks or per-document logic worth running for bulk deletion.
 */
export const pruneActivityLog = async ({
  collectionSlug,
  maxAgeDays,
  payload,
}: {
  collectionSlug: string
  maxAgeDays: number
  payload: Payload
}): Promise<void> => {
  const now = Date.now()
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return
  }
  lastPruneAt = now

  const cutoff = new Date(now - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()

  try {
    await payload.db.deleteMany({
      collection: collectionSlug,
      where: { createdAt: { less_than: cutoff } },
    })
  } catch (err) {
    payload.logger.error({ err, msg: 'activity-log: failed to prune old entries' })
  }
}

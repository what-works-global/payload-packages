/**
 * True when `error` is a MongoDB transient transaction `WriteConflict`
 * (`code === 112`, `codeName === 'WriteConflict'`).
 *
 * Unlike a unique-constraint violation (see `isUniqueViolation`), a write
 * conflict is not a permanent "already done" signal — the server aborted the
 * transaction because another operation touched the same collection at the same
 * time, and MongoDB's contract is that the caller retries it. On a replica set
 * (Atlas) Payload runs local-API writes inside a transaction, and seeding a
 * *fresh* database is where this bites: the first boot is the only one whose
 * roles-collection indexes still need building, and a transactional write to a
 * collection with an in-progress index build conflicts. (Concurrent `onInit`
 * runs — e.g. `next build` static-generation workers — only widen the window;
 * they are not required.) Later boots find the index already built, so the
 * conflict never recurs.
 *
 * SQL adapters have no equivalent, so this is Mongo-only. The original error is
 * checked, and its `cause`, since Payload/drivers sometimes wrap it.
 */
export const isWriteConflict = (error: unknown): boolean => {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue
    }
    if ((candidate as { code?: unknown }).code === 112) {
      return true
    }
    if ((candidate as { codeName?: unknown }).codeName === 'WriteConflict') {
      return true
    }
  }
  return false
}

export type RetryOnWriteConflictOptions = {
  /** Backoff between attempts, multiplied by the attempt number. `0` disables the wait. */
  delayMs?: number
  /** Extra attempts after the first, i.e. up to `retries + 1` total. */
  retries?: number
}

/**
 * Runs `operation`, retrying it while it fails with a transient MongoDB
 * `WriteConflict` (see {@link isWriteConflict}). Any other error — including a
 * unique-constraint violation from a concurrent boot that already seeded the
 * row — is rethrown immediately so callers can handle it. After `retries`
 * retries are exhausted the last conflict is rethrown rather than swallowed, so
 * a genuinely stuck write still surfaces instead of silently doing nothing.
 */
export const retryOnWriteConflict = async <T>(
  operation: () => Promise<T>,
  { delayMs = 50, retries = 5 }: RetryOnWriteConflictOptions = {},
): Promise<T> => {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isWriteConflict(error)) {
        throw error
      }
      lastError = error
      if (attempt < retries && delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
      }
    }
  }
  throw lastError
}

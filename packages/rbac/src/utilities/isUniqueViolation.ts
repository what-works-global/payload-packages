/**
 * True when `error` is a database unique-constraint violation, across the
 * adapters Payload officially ships. The error is what lets seeding stay
 * idempotent under a concurrent-boot race without depending on which adapter
 * (or adapter config) the consumer uses:
 *
 * - MongoDB (`db-mongodb`): duplicate-key error, `code === 11000`.
 * - Postgres (`db-postgres`, `db-vercel-postgres`): SQLSTATE `'23505'`.
 * - SQLite (`db-sqlite`): `SQLITE_CONSTRAINT_UNIQUE` / `SQLITE_CONSTRAINT`.
 *
 * Payload/Drizzle sometimes wrap the driver error, so the original is checked
 * on the error itself and on its `cause`.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue
    }
    const code = (candidate as { code?: unknown }).code
    if (code === 11000) {
      return true
    }
    if (code === '23505') {
      return true
    }
    if (typeof code === 'string' && code.includes('SQLITE_CONSTRAINT')) {
      return true
    }
  }
  return false
}

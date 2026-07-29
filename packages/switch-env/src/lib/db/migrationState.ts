import type { DatabaseAdapter } from 'payload'

import { readdirSync } from 'node:fs'

/**
 * The `payload_migrations.batch` value Payload writes to mark a database whose
 * live schema was last changed by a Drizzle dev push rather than by a migration
 * file. `payload migrate` refuses to run non-interactively while such a row
 * exists — it prompts "It looks like you've run Payload in dev mode ... data
 * loss will occur. Would you like to proceed?" on stdin (see
 * @payloadcms/drizzle's migrate.ts) — and never removes the row afterwards.
 */
export const DEV_PUSH_BATCH = -1

/**
 * Mirrors the gate every Drizzle adapter applies in `connect()` before running
 * Payload's own dev schema push:
 *
 * ```js
 * // @payloadcms/db-postgres/dist/connect.js (identical in db-sqlite)
 * if (process.env.NODE_ENV !== 'production' &&
 *     process.env.PAYLOAD_MIGRATING !== 'true' &&
 *     this.push !== false) {
 *   await pushDevSchema(this)
 * }
 * ```
 *
 * Verified unchanged across Payload 3.54 → 3.85.
 */
export const payloadWouldPushDevSchema = (adapter: DatabaseAdapter): boolean =>
  process.env.NODE_ENV !== 'production' &&
  process.env.PAYLOAD_MIGRATING !== 'true' &&
  (adapter as unknown as { push?: boolean }).push !== false

/**
 * True when the target database's schema is owned by its **migration history**
 * rather than by Drizzle push — so this plugin must never push schema to it and
 * must never write the `batch = -1` dev marker.
 *
 * The signal is the exact inverse of Payload's own push gate (above): the copy
 * flow's `applyDevSchema` is a non-interactive reimplementation of
 * `pushDevSchema`, so it must run under precisely the conditions in which
 * Payload itself is willing to push, and no others. Concretely that means:
 *
 * - `push: false` on the adapter — the consumer's explicit "this database's
 *   schema only changes through migrations" declaration.
 * - `NODE_ENV=production` — a hosted deployment (Vercel sets this for every
 *   environment, including staging). Payload never pushes there, so the
 *   database can only have been built by `payload migrate`, and writing the dev
 *   marker would break the next non-interactive `payload migrate` in its build.
 *
 * Inferring from `buttonMode`/env-name would be guesswork; this is not — it is
 * the adapter's own documented schema policy.
 */
export const isMigrationManagedTarget = (adapter: DatabaseAdapter): boolean =>
  !payloadWouldPushDevSchema(adapter)

/** True when any `payload_migrations` row carries the dev-push marker. */
export const hasDevPushMarker = (rows: Record<string, unknown>[]): boolean =>
  rows.some((row) => Number(row.batch) === DEV_PUSH_BATCH)

/**
 * The migration names Payload would read from `migrationDir` — mirrors
 * `readMigrationFiles` (`.ts`/`.js`, excluding `index.*`, name = basename up to
 * the first dot) without importing the files. Importing is what
 * `db.migrate()` cannot reliably do outside Payload's own CLI, so this stays a
 * pure directory listing: it answers "which migrations should be recorded here"
 * even where `db.migrate()` itself can't run.
 */
export const listMigrationFileNames = (
  migrationDir: string,
  readDir: (dir: string) => string[] = readdirSync,
): string[] => {
  const names = new Set<string>()
  for (const file of readDir(migrationDir).sort()) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) {
      continue
    }
    if (file === 'index.ts' || file === 'index.js' || file.endsWith('.d.ts')) {
      continue
    }
    names.add(file.split('.')[0])
  }
  return [...names]
}

/** On-disk migrations with no `payload_migrations` row — i.e. still pending. */
export const findUnappliedMigrations = (onDisk: string[], applied: string[]): string[] => {
  const appliedNames = new Set(applied)
  return onDisk.filter((name) => !appliedNames.has(name))
}

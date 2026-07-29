import type { PayloadRequest } from 'payload'

import type { RestoreSqlResult } from './db/sql.js'

export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

/**
 * User-facing explanation for a copy whose final schema reconcile paused on
 * rename-shaped ambiguity. The remedy differs by environment: in development a
 * restart lets Payload's boot-time push resolve the renames interactively in
 * the terminal, but that push never runs when NODE_ENV=production (e.g. a
 * staging deployment in `copy` buttonMode) — there the schema difference means
 * this environment is missing migrations, and deploying them (which runs
 * `payload migrate` against this database) resolves it in place.
 */
export const describeDeferredReconcile = (
  deferredReconcile: string[],
  schemaMode: RestoreSqlResult['schemaMode'] = 'push-managed',
): string => {
  const remedy =
    schemaMode === 'migration-managed'
      ? 'This database is migration-managed, so nothing was pushed — it is missing the ' +
        'migrations for these schema changes. Run `payload migrate` against it (e.g. by ' +
        'deploying) to resolve the difference in place.'
      : process.env.NODE_ENV === 'development'
        ? "Restart the dev server so Payload's schema push can resolve these interactively in " +
          'your terminal, or add a migration for the rename and copy again.'
        : 'This environment is missing the migrations for these schema changes — deploy them ' +
          '(running `payload migrate` against this database) to resolve the difference in place.'
  return (
    'possible rename(s) were detected, so the final schema reconcile was skipped:\n\n' +
    deferredReconcile.join('\n') +
    '\n\nThe database is an exact production replica right now — nothing was lost. ' +
    remedy
  )
}

/**
 * Turn a SQL restore result into the caveat a human needs to see. `incomplete`
 * means the rows are in place but the target is NOT at the code's migration
 * state — the copy must not be reported as a plain success.
 *
 * Ordering is by severity: a migration that threw leaves the most surprising
 * state, unrecorded migration files are the precise "this database is behind"
 * signal, and rename ambiguity is the schema-shaped version of the same thing.
 * Read-only drift is deliberately NOT a trigger on its own: in migration-managed
 * mode there is no in-sync baseline database to subtract drizzle-kit's
 * non-idempotent no-ops against (see schemaDrift.ts), so it can't distinguish
 * real drift from noise. It rides along as detail once something else is wrong.
 */
export const describeRestoreResult = (
  result: RestoreSqlResult,
): { detail: null | string; incomplete: boolean } => {
  const drift =
    result.unresolvedDrift.length > 0
      ? `\n\nSchema statement(s) still outstanding (some may be drizzle-kit no-ops):\n${result.unresolvedDrift.join('\n')}`
      : ''

  if (result.migrationError) {
    return {
      detail:
        'the pending migrations could not be applied here: ' +
        `${result.migrationError}\n\nThe data was copied, but this database sits at the source's ` +
        'migration state' +
        (result.schemaMode === 'migration-managed'
          ? ' and nothing was pushed in its place. Run `payload migrate` against it to finish.'
          : '.') +
        drift,
      incomplete: result.schemaMode === 'migration-managed',
    }
  }

  if (result.pendingMigrations.length > 0) {
    return {
      detail:
        `${result.pendingMigrations.length} migration(s) are not recorded in this database:\n\n` +
        result.pendingMigrations.join('\n') +
        '\n\nThe data was copied, but this database is migration-managed, so no schema push was ' +
        'run in their place. Run `payload migrate` against it to finish.' +
        drift,
      incomplete: true,
    }
  }

  if (result.deferredReconcile.length > 0) {
    return {
      // True in both modes: the reconcile stopped short, so the schema is not
      // what the running code expects until the operator acts.
      detail: describeDeferredReconcile(result.deferredReconcile, result.schemaMode),
      incomplete: true,
    }
  }

  return { detail: null, incomplete: false }
}

export const getServerUrl = (req: PayloadRequest) => {
  const host = req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const scheme = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const serverUrl = `${scheme}://${host}`
  return serverUrl
}

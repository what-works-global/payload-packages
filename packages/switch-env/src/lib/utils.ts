import type { PayloadRequest } from 'payload'

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
export const describeDeferredReconcile = (deferredReconcile: string[]): string => {
  const remedy =
    process.env.NODE_ENV === 'development'
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

export const getServerUrl = (req: PayloadRequest) => {
  const host = req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const scheme = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const serverUrl = `${scheme}://${host}`
  return serverUrl
}

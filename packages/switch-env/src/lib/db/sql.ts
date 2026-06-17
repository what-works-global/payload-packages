import type { BackupSqlArgs, RestoreSqlArgs, SqlBackupData } from './sqlShared.js'

import { backupPostgres, restorePostgres } from './postgres.js'
import { backupSqlite, restoreSqlite } from './sqlite.js'

export type { BackupSqlArgs, RestoreSqlArgs, SqlBackupData } from './sqlShared.js'

const isPostgres = (adapterName: string | undefined): boolean => adapterName === 'postgres'

/**
 * Dialect dispatch for the SQL copy flow. Both Drizzle adapters route through
 * here; the SQLite (libSQL) and Postgres implementations live in their own
 * modules because the two drivers and dialects diverge almost completely
 * (libSQL `client` + `sqlite_master` + `PRAGMA` vs. `pg` pool +
 * `information_schema` + `session_replication_role`).
 */
export const backupSql = (args: BackupSqlArgs): Promise<SqlBackupData> =>
  isPostgres(args.sourceAdapter.name) ? backupPostgres(args) : backupSqlite(args)

export const restoreSql = (args: RestoreSqlArgs): Promise<void> =>
  isPostgres(args.targetAdapter.name) ? restorePostgres(args) : restoreSqlite(args)

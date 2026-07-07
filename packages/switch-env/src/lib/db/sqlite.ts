import type { DatabaseAdapter } from 'payload'

import { existsSync } from 'node:fs'

import type { BackupSqlArgs, RestoreSqlArgs, RestoreSqlResult, SqlBackupData } from './sqlShared.js'

import {
  applyDevSchema,
  filterLatestXPerParent,
  filterLatestXRows,
  PAYLOAD_MIGRATIONS_TABLE,
  quoteIdent,
  requireDrizzleKitApi,
  resolveBaseTableModes,
  resolveVersionTableModes,
  rowToObject,
  runPendingMigrations,
} from './sqlShared.js'

type LibSqlInValue = ArrayBuffer | bigint | boolean | Date | null | number | string | Uint8Array

type LibSqlStatement = { args: LibSqlInValue[]; sql: string } | string

interface LibSqlResultSet {
  columns: string[]
  rows: Array<Record<string, unknown>>
}

interface LibSqlClient {
  batch(stmts: LibSqlStatement[], mode?: 'deferred' | 'read' | 'write'): Promise<LibSqlResultSet[]>
  execute(stmt: LibSqlStatement): Promise<LibSqlResultSet>
  // Wraps the batch in PRAGMA foreign_keys=off; ... PRAGMA foreign_keys=on;
  migrate(stmts: LibSqlStatement[]): Promise<LibSqlResultSet[]>
}

const isSystemObject = (name: string) =>
  name.startsWith('sqlite_') || name === 'libsql_wasm_func_table'

const getClient = (adapter: DatabaseAdapter): LibSqlClient => {
  const client = (adapter as unknown as { client?: LibSqlClient }).client
  if (!client || typeof client.execute !== 'function' || typeof client.migrate !== 'function') {
    throw new Error('[switch-env] expected SQLite adapter with a libSQL `client`')
  }
  return client
}

const buildInsertStatements = (
  tableName: string,
  rows: Record<string, unknown>[],
): LibSqlStatement[] => {
  if (rows.length === 0) {
    return []
  }
  const columns = Object.keys(rows[0])
  if (columns.length === 0) {
    return []
  }

  const columnList = columns.map(quoteIdent).join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  const sql = `INSERT INTO ${quoteIdent(tableName)} (${columnList}) VALUES (${placeholders})`

  return rows.map((row) => ({
    args: columns.map((c) => (row[c] === undefined ? null : (row[c] as LibSqlInValue))),
    sql,
  }))
}

export const backupSqlite = async ({
  copyConfig,
  payload,
  sourceAdapter,
}: BackupSqlArgs): Promise<SqlBackupData> => {
  const client = getClient(sourceAdapter)
  const baseModes = resolveBaseTableModes(payload, copyConfig)
  const versionModes = resolveVersionTableModes(payload, copyConfig)

  // Capture CREATE TABLE first, then CREATE INDEX, so replay order is safe.
  const schemaRs = await client.execute(
    'SELECT type, name, sql FROM sqlite_master ' +
      "WHERE type IN ('table', 'index') AND sql IS NOT NULL " +
      "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
  )

  const schema: string[] = []
  const tableNames: string[] = []
  for (const row of schemaRs.rows) {
    const name = row.name as string
    if (isSystemObject(name)) {
      continue
    }
    schema.push(row.sql as string)
    if ((row.type as string) === 'table') {
      tableNames.push(name)
    }
  }

  const tables: Record<string, Record<string, unknown>[]> = {}
  let migrations: Record<string, unknown>[] = []
  for (const tableName of tableNames) {
    const baseMode = baseModes[tableName]
    if (baseMode?.mode === 'none') {
      // Schema replay still happens, but the table stays empty on target.
      continue
    }

    const rs = await client.execute(`SELECT * FROM ${quoteIdent(tableName)}`)
    let rows = rs.rows.map((row) => rowToObject(row, rs.columns))

    if (baseMode?.mode === 'latest-x') {
      rows = filterLatestXRows(rows, baseMode.x)
    }

    const versionMode = versionModes[tableName]
    if (versionMode && versionMode.mode === 'latest-x') {
      rows = filterLatestXPerParent(rows, versionMode.x)
    }

    if (tableName === PAYLOAD_MIGRATIONS_TABLE) {
      migrations = rows
    } else {
      tables[tableName] = rows
    }
  }

  return { migrations, schema, tables }
}

export const restoreSqlite = async ({
  backupData,
  logger,
  targetAdapter,
}: RestoreSqlArgs): Promise<RestoreSqlResult> => {
  // Resolve before touching the target: the restore below is destructive
  // (drops every table), so a missing drizzle-kit must abort the whole operation.
  requireDrizzleKitApi(targetAdapter)
  const client = getClient(targetAdapter)

  const existingRs = await client.execute(
    'SELECT type, name FROM sqlite_master ' +
      "WHERE type IN ('table', 'index') AND sql IS NOT NULL",
  )

  const dropIndexes: LibSqlStatement[] = []
  const dropTables: LibSqlStatement[] = []
  for (const row of existingRs.rows) {
    const name = row.name as string
    if (isSystemObject(name)) {
      continue
    }
    if ((row.type as string) === 'index') {
      dropIndexes.push(`DROP INDEX IF EXISTS ${quoteIdent(name)}`)
    } else {
      dropTables.push(`DROP TABLE IF EXISTS ${quoteIdent(name)}`)
    }
  }

  const inserts: LibSqlStatement[] = []
  for (const [tableName, rows] of Object.entries(backupData.tables)) {
    inserts.push(...buildInsertStatements(tableName, rows))
  }
  inserts.push(...buildInsertStatements(PAYLOAD_MIGRATIONS_TABLE, backupData.migrations))

  await client.migrate([...dropIndexes, ...dropTables, ...backupData.schema, ...inserts])

  // payload.db.migrate prompts the user when it sees a batch=-1 ("dev") row —
  // unworkable in headless contexts. Strip it; applyDevSchema re-inserts it below.
  await client.execute(`DELETE FROM ${quoteIdent(PAYLOAD_MIGRATIONS_TABLE)} WHERE batch = -1`)

  // Apply any pending migration files (e.g. renames the dev wrote but prod
  // hasn't run yet). Best-effort — see runPendingMigrations.
  await runPendingMigrations(targetAdapter, existsSync, logger)

  // Source schema is now on the target, but the dev's Drizzle schema may know
  // about columns/tables that don't exist yet (i.e. unmigrated dev changes).
  // Reconcile by running drizzle-kit's push against the live DB, without
  // pushDevSchema's interactive data-loss prompt — or pause on rename-shaped
  // ambiguity.
  return applyDevSchema(targetAdapter, logger)
}

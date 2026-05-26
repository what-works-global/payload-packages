import type { BasePayload, DatabaseAdapter } from 'payload'

import { pushDevSchema } from '@payloadcms/drizzle'
import { existsSync } from 'node:fs'

import type { CopyConfig } from '../../types.js'

export interface SqlBackupData {
  /**
   * The `payload_migrations` rows from the source so the target knows where it
   * sits in the migration timeline.
   */
  migrations: Record<string, unknown>[]
  /**
   * CREATE TABLE / CREATE INDEX statements captured from the source schema, in
   * the order they should be re-applied to the target.
   */
  schema: string[]
  /**
   * Raw table rows keyed by table name. Side tables (locales/rels/blocks/versions)
   * are included alongside their parents to keep partial copies consistent.
   */
  tables: Record<string, Record<string, unknown>[]>
}

export interface BackupSqlArgs {
  copyConfig?: CopyConfig
  payload: BasePayload
  sourceAdapter: DatabaseAdapter
}

export interface RestoreSqlArgs {
  backupData: SqlBackupData
  logger: BasePayload['logger']
  payload: BasePayload
  targetAdapter: DatabaseAdapter
}

type LibSqlInValue =
  | ArrayBuffer
  | bigint
  | boolean
  | Date
  | null
  | number
  | string
  | Uint8Array

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

const PAYLOAD_MIGRATIONS_TABLE = 'payload_migrations'

const isSystemObject = (name: string) =>
  name.startsWith('sqlite_') || name === 'libsql_wasm_func_table'

const getClient = (adapter: DatabaseAdapter): LibSqlClient => {
  const client = (adapter as unknown as { client?: LibSqlClient }).client
  if (
    !client ||
    typeof client.execute !== 'function' ||
    typeof client.migrate !== 'function'
  ) {
    throw new Error('[switch-env] expected SQLite adapter with a libSQL `client`')
  }
  return client
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

const rowToObject = (
  row: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> => {
  const obj: Record<string, unknown> = {}
  for (const column of columns) {
    obj[column] = row[column]
  }
  return obj
}

interface BaseTableMode {
  mode: 'all' | 'latest-x' | 'none'
  /** Only set when mode === 'latest-x'. */
  x: number
}

interface VersionTableMode {
  /** Coerced from CopyVersionsMode — 'none' becomes latest-x:1 to match mongo. */
  mode: 'all' | 'latest-x'
  x: number
}

const resolveSqlBaseTableName = (config: {
  dbName?: ((args: Record<string, never>) => string) | string
  slug: string
}): string => {
  if (typeof config.dbName === 'function') {return config.dbName({})}
  if (typeof config.dbName === 'string' && config.dbName.length > 0) {return config.dbName}
  // Payload converts kebab-case slugs to snake_case table names in its SQL adapters.
  return config.slug.replace(/-/g, '_')
}

const coerceBaseMode = (
  mode: { mode: 'all' } | { mode: 'latest-x'; x: number } | { mode: 'none' } | undefined,
): BaseTableMode => {
  if (!mode) {return { mode: 'all', x: 0 }}
  if (mode.mode === 'latest-x') {return { mode: 'latest-x', x: mode.x }}
  return { mode: mode.mode, x: 0 }
}

const coerceVersionMode = (
  mode: { mode: 'all' } | { mode: 'latest-x'; x: number } | { mode: 'none' } | undefined,
): VersionTableMode => {
  if (!mode || mode.mode === 'all') {return { mode: 'all', x: 0 }}
  // 'none' means "only the latest version per parent" — mirrors the mongo coercion in copyUtils.
  if (mode.mode === 'none') {return { mode: 'latest-x', x: 1 }}
  return { mode: 'latest-x', x: mode.x }
}

const resolveBaseTableModes = (
  payload: BasePayload,
  copyConfig: CopyConfig | undefined,
): Record<string, BaseTableMode> => {
  const result: Record<string, BaseTableMode> = {}
  const documentsConfig = copyConfig?.documents ?? {}
  const defaultMode = coerceBaseMode(documentsConfig.default)

  for (const collection of payload.config.collections ?? []) {
    const tableName = resolveSqlBaseTableName(collection)
    const override =
      documentsConfig.collections?.[collection.slug]
    result[tableName] = override ? coerceBaseMode(override) : defaultMode
  }
  for (const global of payload.config.globals ?? []) {
    const tableName = resolveSqlBaseTableName(global)
    const override =
      documentsConfig.globals?.[global.slug]
    result[tableName] = override ? coerceBaseMode(override) : defaultMode
  }
  return result
}

const resolveVersionTableModes = (
  payload: BasePayload,
  copyConfig: CopyConfig | undefined,
): Record<string, VersionTableMode> => {
  const result: Record<string, VersionTableMode> = {}
  const versionsConfig = copyConfig?.versions ?? {}
  const defaultMode = coerceVersionMode(versionsConfig.default)

  for (const collection of payload.config.collections ?? []) {
    if (!collection.versions) {continue}
    const base = resolveSqlBaseTableName(collection)
    const override =
      versionsConfig.collections?.[collection.slug]
    result[`_${base}_v`] = override ? coerceVersionMode(override) : defaultMode
  }
  for (const global of payload.config.globals ?? []) {
    if (!global.versions) {continue}
    const base = resolveSqlBaseTableName(global)
    const override =
      versionsConfig.globals?.[global.slug]
    result[`_${base}_v`] = override ? coerceVersionMode(override) : defaultMode
  }
  return result
}

const toNumeric = (v: unknown): number => {
  if (typeof v === 'number') {return v}
  if (typeof v === 'boolean') {return v ? 1 : 0}
  if (typeof v === 'bigint') {return Number(v)}
  return 0
}

const filterLatestXRows = (
  rows: Record<string, unknown>[],
  x: number,
): Record<string, unknown>[] => {
  if (rows.length === 0 || x < 1) {return []}
  const sorted = [...rows].sort((a, b) => {
    const aUpd = String(a.updated_at ?? '')
    const bUpd = String(b.updated_at ?? '')
    if (aUpd !== bUpd) {return aUpd < bUpd ? 1 : -1}
    const aId = String(a.id ?? '')
    const bId = String(b.id ?? '')
    return aId < bId ? 1 : -1
  })
  return sorted.slice(0, x)
}

const filterLatestXPerParent = (
  rows: Record<string, unknown>[],
  x: number,
): Record<string, unknown>[] => {
  if (rows.length === 0 || x < 1) {return []}
  // Sort descending by (latest, updated_at, id). Mirrors the mongo path which
  // prioritizes latest=true so list views in the target admin still find docs.
  const sorted = [...rows].sort((a, b) => {
    const latestDiff = toNumeric(b.latest) - toNumeric(a.latest)
    if (latestDiff !== 0) {return latestDiff}
    const aUpd = String(a.updated_at ?? '')
    const bUpd = String(b.updated_at ?? '')
    if (aUpd !== bUpd) {return aUpd < bUpd ? 1 : -1}
    const aId = String(a.id ?? '')
    const bId = String(b.id ?? '')
    return aId < bId ? 1 : -1
  })

  const perParent = new Map<unknown, Record<string, unknown>[]>()
  for (const row of sorted) {
    const parent = row.parent_id
    const list = perParent.get(parent) ?? []
    if (list.length < x) {
      list.push(row)
      perParent.set(parent, list)
    }
  }
  return Array.from(perParent.values()).flat()
}

const buildInsertStatements = (
  tableName: string,
  rows: Record<string, unknown>[],
): LibSqlStatement[] => {
  if (rows.length === 0) {return []}
  const columns = Object.keys(rows[0])
  if (columns.length === 0) {return []}

  const columnList = columns.map(quoteIdent).join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  const sql = `INSERT INTO ${quoteIdent(tableName)} (${columnList}) VALUES (${placeholders})`

  return rows.map((row) => ({
    args: columns.map((c) => (row[c] === undefined ? null : (row[c] as LibSqlInValue))),
    sql,
  }))
}

export const backupSql = async ({
  copyConfig,
  payload,
  sourceAdapter,
}: BackupSqlArgs): Promise<SqlBackupData> => {
  const client = getClient(sourceAdapter)
  const baseModes = resolveBaseTableModes(payload, copyConfig)
  const versionModes = resolveVersionTableModes(payload, copyConfig)

  // Capture CREATE TABLE first, then CREATE INDEX, so replay order is safe.
  const schemaRs = await client.execute(
    "SELECT type, name, sql FROM sqlite_master " +
      "WHERE type IN ('table', 'index') AND sql IS NOT NULL " +
      "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
  )

  const schema: string[] = []
  const tableNames: string[] = []
  for (const row of schemaRs.rows) {
    const name = row.name as string
    if (isSystemObject(name)) {continue}
    schema.push(row.sql as string)
    if ((row.type as string) === 'table') {tableNames.push(name)}
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

export const restoreSql = async ({
  backupData,
  targetAdapter,
}: RestoreSqlArgs): Promise<void> => {
  const client = getClient(targetAdapter)

  const existingRs = await client.execute(
    "SELECT type, name FROM sqlite_master " +
      "WHERE type IN ('table', 'index') AND sql IS NOT NULL",
  )

  const dropIndexes: LibSqlStatement[] = []
  const dropTables: LibSqlStatement[] = []
  for (const row of existingRs.rows) {
    const name = row.name as string
    if (isSystemObject(name)) {continue}
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

  await client.migrate([
    ...dropIndexes,
    ...dropTables,
    ...backupData.schema,
    ...inserts,
  ])

  // payload.db.migrate prompts the user when it sees a batch=-1 ("dev") row —
  // unworkable in headless contexts. Strip it; pushDevSchema re-inserts it below.
  await client.execute(`DELETE FROM ${quoteIdent(PAYLOAD_MIGRATIONS_TABLE)} WHERE batch = -1`)

  // Apply any pending migration files (e.g. renames the dev wrote but prod
  // hasn't run yet). The migrate function is what Payload itself calls when
  // running `payload migrate`; readMigrationFiles loads from `db.migrationDir`.
  // Skip when there's no migrationDir on disk — readMigrationFiles logs an
  // ERROR in that case even though it gracefully returns [].
  const migrationDir = (targetAdapter as unknown as { migrationDir?: string }).migrationDir
  const migrate = (targetAdapter as unknown as { migrate?: () => Promise<void> }).migrate
  if (typeof migrate === 'function' && migrationDir && existsSync(migrationDir)) {
    await migrate.call(targetAdapter)
  }

  // Source schema is now on the target, but the dev's Drizzle schema may know
  // about columns/tables that don't exist yet (i.e. unmigrated dev changes).
  // Force-push reconciles by running drizzle-kit's push against the live DB.
  // The previousSchema cache inside pushDevSchema can silently no-op the second
  // push in a process — PAYLOAD_FORCE_DRIZZLE_PUSH=true is the documented bypass.
  const previousForce = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  try {
    await pushDevSchema(targetAdapter as unknown as Parameters<typeof pushDevSchema>[0])
  } finally {
    if (previousForce === undefined) {
      delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH
    } else {
      process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = previousForce
    }
  }
}

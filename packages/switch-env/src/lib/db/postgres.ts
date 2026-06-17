import type { DatabaseAdapter } from 'payload'

import { existsSync } from 'node:fs'

import type { BackupSqlArgs, RestoreSqlArgs, SqlBackupData } from './sqlShared.js'

import {
  filterLatestXPerParent,
  filterLatestXRows,
  forcePushDevSchema,
  importPushDevSchema,
  PAYLOAD_MIGRATIONS_TABLE,
  quoteIdent,
  resolveBaseTableModes,
  resolveVersionTableModes,
  runPendingMigrations,
} from './sqlShared.js'

interface PgQueryResult {
  fields: Array<{ dataTypeID: number; name: string }>
  rows: Array<Record<string, unknown>>
}

interface PgClient {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>
  release: () => void
}

interface PgPool {
  connect: () => Promise<PgClient>
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>
}

interface PgAdapter {
  pool: PgPool
  schema: string
}

const getPgAdapter = (adapter: DatabaseAdapter): PgAdapter => {
  const pool = (adapter as unknown as { pool?: PgPool }).pool
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('[switch-env] expected Postgres adapter with a `pg` pool')
  }
  const schemaName = (adapter as unknown as { schemaName?: string }).schemaName
  return { pool, schema: schemaName || 'public' }
}

const qualify = (schema: string, table: string) => `${quoteIdent(schema)}.${quoteIdent(table)}`

/** Base tables (excludes views) in the adapter's schema, alphabetically. */
const listBaseTables = async (pool: PgPool, schema: string): Promise<string[]> => {
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  )
  return result.rows.map((row) => String(row.table_name))
}

/**
 * Maps each table to the set of its `json`/`jsonb` columns. Postgres returns
 * those columns already parsed into JS objects/arrays; on insert we must hand
 * them back as JSON text (not as JS objects, which node-postgres would coerce
 * into a Postgres array literal and corrupt). See `bindValue` below.
 */
const getJsonColumnsByTable = async (
  pool: PgPool,
  schema: string,
): Promise<Record<string, Set<string>>> => {
  const result = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = $1 AND data_type IN ('json', 'jsonb')`,
    [schema],
  )
  const byTable: Record<string, Set<string>> = {}
  for (const row of result.rows) {
    const table = String(row.table_name)
    ;(byTable[table] ??= new Set()).add(String(row.column_name))
  }
  return byTable
}

const bindValue = (value: unknown, isJsonColumn: boolean): unknown => {
  if (value === undefined) {
    return null
  }
  // Re-serialize JSON columns: pass JSON text so Postgres re-parses it into the
  // same value, regardless of whether it was an object, array, or scalar.
  if (isJsonColumn && value !== null) {
    return JSON.stringify(value)
  }
  return value
}

const insertRows = async (
  client: PgClient,
  schema: string,
  tableName: string,
  rows: Record<string, unknown>[],
  jsonColumns: Set<string>,
): Promise<void> => {
  if (rows.length === 0) {
    return
  }
  const columns = Object.keys(rows[0])
  if (columns.length === 0) {
    return
  }

  const columnList = columns.map(quoteIdent).join(', ')
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  const text = `INSERT INTO ${qualify(schema, tableName)} (${columnList}) VALUES (${placeholders})`

  for (const row of rows) {
    const values = columns.map((column) => bindValue(row[column], jsonColumns.has(column)))
    await client.query(text, values)
  }
}

/**
 * After inserting explicit primary-key values the backing identity/serial
 * sequence is left behind, so the next insert in development would collide.
 * Advance each table's `id` sequence past the highest value we restored.
 */
const resetSequences = async (
  pool: PgPool,
  schema: string,
  tableNames: string[],
): Promise<void> => {
  // Only tables with an `id` column can have an id sequence; querying
  // pg_get_serial_sequence for a missing column would raise (e.g. payload_kv,
  // keyed on `key`), so filter first.
  const idColumnResult = await pool.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = $1 AND column_name = 'id'`,
    [schema],
  )
  const tablesWithId = new Set(idColumnResult.rows.map((row) => String(row.table_name)))

  for (const tableName of tableNames) {
    if (!tablesWithId.has(tableName)) {
      continue
    }
    const seqResult = await pool.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [
      qualify(schema, tableName),
    ])
    const sequence = seqResult.rows[0]?.seq
    if (typeof sequence !== 'string' || sequence.length === 0) {
      continue
    }
    // setval to MAX(id); is_called=true so nextval returns MAX(id)+1. Skip when
    // the table is empty (no MAX) — TRUNCATE ... RESTART IDENTITY already reset it.
    await pool.query(
      `SELECT setval($1, (SELECT MAX(id) FROM ${qualify(schema, tableName)}), true)
       WHERE (SELECT MAX(id) FROM ${qualify(schema, tableName)}) IS NOT NULL`,
      [sequence],
    )
  }
}

export const backupPostgres = async ({
  copyConfig,
  payload,
  sourceAdapter,
}: BackupSqlArgs): Promise<SqlBackupData> => {
  const { pool, schema } = getPgAdapter(sourceAdapter)
  const baseModes = resolveBaseTableModes(payload, copyConfig)
  const versionModes = resolveVersionTableModes(payload, copyConfig)

  const tableNames = await listBaseTables(pool, schema)

  const tables: Record<string, Record<string, unknown>[]> = {}
  let migrations: Record<string, unknown>[] = []
  for (const tableName of tableNames) {
    const baseMode = baseModes[tableName]
    if (baseMode?.mode === 'none') {
      // Skip: the table stays empty on the target.
      continue
    }

    const rs = await pool.query(`SELECT * FROM ${qualify(schema, tableName)}`)
    let rows = rs.rows

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

  // Postgres rebuilds its schema with pushDevSchema on restore (no DDL replay),
  // so `schema` is intentionally empty.
  return { migrations, schema: [], tables }
}

export const restorePostgres = async ({
  backupData,
  targetAdapter,
}: RestoreSqlArgs): Promise<void> => {
  // Resolve before touching the target: the restore below is destructive, so a
  // missing peer must abort the whole operation.
  const pushDevSchemaFn = await importPushDevSchema()
  const { pool, schema } = getPgAdapter(targetAdapter)

  // Make sure the development schema is materialized on the target before we
  // wipe and reload data — handles a brand-new target database whose tables
  // have not been pushed yet.
  await forcePushDevSchema(pushDevSchemaFn, targetAdapter)

  const allTables = await listBaseTables(pool, schema)
  const jsonColumnsByTable = await getJsonColumnsByTable(pool, schema)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Disable FK / trigger enforcement for the load so insert order is
    // irrelevant. SET LOCAL is transaction-scoped and reverts on COMMIT.
    // Requires a sufficiently privileged role (the local development user).
    await client.query("SET LOCAL session_replication_role = 'replica'")

    if (allTables.length > 0) {
      const list = allTables.map((table) => qualify(schema, table)).join(', ')
      await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
    }

    for (const [tableName, rows] of Object.entries(backupData.tables)) {
      await insertRows(client, schema, tableName, rows, jsonColumnsByTable[tableName] ?? new Set())
    }
    await insertRows(
      client,
      schema,
      PAYLOAD_MIGRATIONS_TABLE,
      backupData.migrations,
      jsonColumnsByTable[PAYLOAD_MIGRATIONS_TABLE] ?? new Set(),
    )

    // payload.db.migrate prompts the user when it sees a batch=-1 ("dev") row —
    // unworkable in headless contexts. Strip it; pushDevSchema re-inserts it below.
    await client.query(`DELETE FROM ${qualify(schema, PAYLOAD_MIGRATIONS_TABLE)} WHERE batch = -1`)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  // Advance identity sequences past the restored rows so subsequent dev inserts
  // don't collide on the primary key.
  await resetSequences(pool, schema, [...Object.keys(backupData.tables), PAYLOAD_MIGRATIONS_TABLE])

  // Apply any pending migration files (e.g. renames the dev wrote but prod
  // hasn't run yet).
  await runPendingMigrations(targetAdapter, existsSync)

  // Reconcile any unmigrated dev-only schema changes against the live DB.
  await forcePushDevSchema(pushDevSchemaFn, targetAdapter)
}

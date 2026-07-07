import type { DatabaseAdapter } from 'payload'

import { existsSync } from 'node:fs'

import type { BackupSqlArgs, RestoreSqlArgs, RestoreSqlResult, SqlBackupData } from './sqlShared.js'

import { capturePostgresDdl, EXTENSION_DDL_PREFIX } from './postgresDdl.js'
import {
  applyDevSchema,
  filterLatestXPerParent,
  filterLatestXRows,
  PAYLOAD_MIGRATIONS_TABLE,
  quoteIdent,
  requireDrizzleKitApi,
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

/**
 * Base tables (excludes views) in the adapter's schema, alphabetically.
 * Extension members (e.g. postgis's spatial_ref_sys) are excluded: the restore
 * recreates them via CREATE EXTENSION — including their seed rows — so backing
 * up their data would only produce duplicate-key failures on reload.
 */
const listBaseTables = async (pool: PgPool, schema: string): Promise<string[]> => {
  const result = await pool.query(
    `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
           AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
       )
     ORDER BY c.relname`,
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
  queryRunner: Pick<PgPool, 'query'>,
  schema: string,
): Promise<Record<string, Set<string>>> => {
  const result = await queryRunner.query(
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

  // Capture the source's DDL on a dedicated client — the capture pins the
  // session's search_path, which must not leak into other pooled queries.
  const ddlClient = await pool.connect()
  let schemaDdl: string[]
  try {
    schemaDdl = await capturePostgresDdl(ddlClient, schema)
  } finally {
    ddlClient.release()
  }

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

  return { migrations, schema: schemaDdl, tables }
}

/**
 * Replay a captured DDL statement inside the restore transaction. Extension
 * statements soft-fail in a savepoint: production may carry provider extensions
 * (e.g. Neon's `neon`) the local Postgres has no binaries for, and a table that
 * genuinely needs a missing extension still fails loudly on its CREATE TABLE.
 */
const replayDdlStatement = async (
  client: PgClient,
  statement: string,
  logger: RestoreSqlArgs['logger'],
): Promise<void> => {
  if (!statement.startsWith(EXTENSION_DDL_PREFIX)) {
    await client.query(statement)
    return
  }
  await client.query('SAVEPOINT switch_env_extension')
  try {
    await client.query(statement)
    await client.query('RELEASE SAVEPOINT switch_env_extension')
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT switch_env_extension')
    logger.warn(
      { err: error },
      `[switch-env] could not recreate a production extension locally, continuing: ${statement}`,
    )
  }
}

export const restorePostgres = async ({
  backupData,
  logger,
  targetAdapter,
}: RestoreSqlArgs): Promise<RestoreSqlResult> => {
  // Resolve before touching the target: the restore below is destructive, so a
  // missing drizzle-kit must abort while the target is still intact.
  requireDrizzleKitApi(targetAdapter)
  const { pool, schema } = getPgAdapter(targetAdapter)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Disable FK / trigger enforcement for the load so insert order is
    // irrelevant. SET LOCAL is transaction-scoped and reverts on COMMIT.
    // Requires a sufficiently privileged role (the local development user).
    await client.query("SET LOCAL session_replication_role = 'replica'")

    // Rebuild the target as the SOURCE's schema, not the local code schema:
    // dropping the whole Postgres schema and replaying the captured DDL means
    // the source rows always fit, even when the local code schema has
    // progressed (renamed/removed columns, new NOT NULL fields, new tables).
    // Postgres DDL is transactional, so a failure anywhere rolls the target
    // back untouched. The recreated schema is owned by the connecting role;
    // that role is the only user of a development database.
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`)
    await client.query(`CREATE SCHEMA ${quoteIdent(schema)}`)
    // The captured DDL is unqualified — aim it at the recreated schema.
    await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}`)
    for (const statement of backupData.schema) {
      await replayDdlStatement(client, statement, logger)
    }

    // Must be computed after the replay (and inside the transaction): the JSON
    // columns that matter are the SOURCE's, which now exist on the target.
    const jsonColumnsByTable = await getJsonColumnsByTable(client, schema)

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
    // unworkable in headless contexts. Strip it; applyDevSchema re-inserts it
    // below. Guarded: an empty source database has no migrations table at all.
    const migrationsTable = await client.query(`SELECT to_regclass($1) AS reg`, [
      qualify(schema, PAYLOAD_MIGRATIONS_TABLE),
    ])
    if (migrationsTable.rows[0]?.reg) {
      await client.query(
        `DELETE FROM ${qualify(schema, PAYLOAD_MIGRATIONS_TABLE)} WHERE batch = -1`,
      )
    }

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

  // Apply any pending migration files (i.e. local migrations production hasn't
  // run yet) against the freshly restored production schema + data, so their
  // backfills and renames transform the production rows the way the migration
  // author intended. Best-effort — see runPendingMigrations.
  await runPendingMigrations(targetAdapter, existsSync, logger)

  // Reconcile any remaining (unmigrated) dev-only schema changes against the
  // live DB, non-interactively — or pause on rename-shaped ambiguity.
  return applyDevSchema(targetAdapter, logger)
}

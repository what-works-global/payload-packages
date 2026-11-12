import type { DatabaseAdapter } from 'payload'

import type { BackupSqlArgs, RestoreSqlArgs, RestoreSqlResult, SqlBackupData } from './sqlShared.js'

import { capturePostgresDdl, captureSchemaPrivileges, EXTENSION_DDL_PREFIX } from './postgresDdl.js'
import {
  filterLatestXPerParent,
  filterLatestXRows,
  finalizeRestore,
  PAYLOAD_MIGRATIONS_TABLE,
  preflightRestore,
  quoteIdent,
  resolveBaseTableModes,
  resolveVersionTableModes,
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

/**
 * Postgres caps one statement at 65,535 bind parameters (the wire protocol
 * counts them in an Int16), so a batch holds at most this many values.
 */
const MAX_BIND_PARAMETERS = 65_535

/**
 * Rows per INSERT, before the parameter cap. Each statement is a network round
 * trip, so the restore's speed is set by how many statements it sends: against
 * a remote database a few ms away, one INSERT per row makes a copy of a few
 * hundred thousand rows take around ten minutes. A thousand rows keeps each
 * statement's text and values modest while making round trips negligible.
 */
const MAX_ROWS_PER_INSERT = 1_000

/** How many rows of a table with `columnCount` columns fit in one INSERT. */
export const rowsPerInsert = (columnCount: number): number =>
  Math.max(1, Math.min(MAX_ROWS_PER_INSERT, Math.floor(MAX_BIND_PARAMETERS / columnCount)))

/**
 * Loads `rows` with multi-row INSERTs. A VALUES list written directly in an
 * INSERT is coerced to the target columns' types, so the parameters bind
 * exactly as they would one row at a time.
 */
export const insertRows = async (
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
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

  const prefix = `INSERT INTO ${qualify(schema, tableName)} (${columns.map(quoteIdent).join(', ')}) VALUES `
  const batchSize = rowsPerInsert(columns.length)

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const values: unknown[] = []
    const tuples: string[] = []
    for (const row of batch) {
      const placeholders: string[] = []
      for (const column of columns) {
        values.push(bindValue(row[column], jsonColumns.has(column)))
        placeholders.push(`$${values.length}`)
      }
      tuples.push(`(${placeholders.join(', ')})`)
    }
    try {
      await client.query(prefix + tuples.join(', '), values)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `[switch-env] could not restore rows ${start + 1}–${start + batch.length} of ${rows.length} into "${tableName}": ${reason}`,
        { cause: error },
      )
    }
  }
}

/**
 * How long the restore waits for each lock before giving up. Dropping the
 * schema needs an exclusive lock on every table, so a connection that keeps a
 * transaction open on the target would otherwise stall the copy until the
 * host kills it — while every other query on those tables queues behind it.
 */
export const RESTORE_LOCK_TIMEOUT_MS = 30_000

/** SQLSTATE 55P03: a lock was not granted within `lock_timeout`. */
const isLockTimeout = (error: unknown): boolean => {
  const { cause, code } = (error ?? {}) as { cause?: { code?: unknown }; code?: unknown }
  return code === '55P03' || cause?.code === '55P03'
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
    // A single calm line, not the error object: pino would render its full
    // stack, making a routine skip (Supabase/Neon carry several provider
    // extensions with no local binaries) read like a failed copy.
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[switch-env] skipped \`${statement}\` (${reason}) — fine unless your tables use this extension, in which case a later CREATE TABLE fails loudly`,
    )
  }
}

export const restorePostgres = async ({
  backupData,
  lockTimeoutMs = RESTORE_LOCK_TIMEOUT_MS,
  logger,
  targetAdapter,
}: RestoreSqlArgs): Promise<RestoreSqlResult> => {
  // Everything below is destructive, so anything that can rule the copy out
  // must be checked here, while the target is still intact.
  preflightRestore({ backupData, targetAdapter })
  const { pool, schema } = getPgAdapter(targetAdapter)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Disable FK / trigger enforcement for the load so insert order is
    // irrelevant. SET LOCAL is transaction-scoped and reverts on COMMIT.
    // Requires a sufficiently privileged role (the local development user).
    await client.query("SET LOCAL session_replication_role = 'replica'")
    // Fail fast, with nothing changed, rather than wait indefinitely behind a
    // connection that holds the target's tables (see RESTORE_LOCK_TIMEOUT_MS).
    await client.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.floor(lockTimeoutMs))}`)

    // Capture the target schema's OWN privileges before the drop discards them:
    // the schema-level ACL + default privileges. A managed target (Supabase,
    // Neon) grants its API roles here, and DROP SCHEMA would silently break its
    // data API — see captureSchemaPrivileges. Replayed below, before the table
    // DDL, so the recreated tables inherit the default privileges.
    const schemaPrivileges = await captureSchemaPrivileges(client, schema)

    // Rebuild the target as the SOURCE's schema, not the local code schema:
    // dropping the whole Postgres schema and replaying the captured DDL means
    // the source rows always fit, even when the local code schema has
    // progressed (renamed/removed columns, new NOT NULL fields, new tables).
    // Postgres DDL is transactional, so a failure anywhere rolls the target
    // back untouched. The recreated schema is owned by the connecting role; its
    // schema-level grants + default privileges are re-applied from the capture
    // above so a managed target keeps its API-role access.
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`)
    await client.query(`CREATE SCHEMA ${quoteIdent(schema)}`)
    // The captured DDL is unqualified — aim it at the recreated schema.
    await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}`)
    // Re-apply the schema's grants + default privileges FIRST, so every table
    // the DDL replay recreates picks up the default privileges as it is created.
    for (const statement of schemaPrivileges) {
      await client.query(statement)
    }
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
    // unworkable in headless contexts. Strip it; on a push-managed target
    // applyDevSchema re-inserts it below, and a migration-managed target never
    // gets this far with one (preflightRestore refuses the copy instead).
    // Guarded: an empty source database has no migrations table at all.
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
    if (isLockTimeout(error)) {
      throw new Error(
        `[switch-env] could not lock the target database's tables within ${Math.round(lockTimeoutMs / 1000)}s: another connection is holding them, often a transaction left open. Nothing was changed. Try again, or end that connection first.`,
        { cause: error },
      )
    }
    throw error
  } finally {
    client.release()
  }

  // Advance identity sequences past the restored rows so subsequent dev inserts
  // don't collide on the primary key.
  await resetSequences(pool, schema, [...Object.keys(backupData.tables), PAYLOAD_MIGRATIONS_TABLE])

  // Migrate the restored replica forward, then reconcile or report — see
  // finalizeRestore.
  return finalizeRestore({ logger, targetAdapter })
}

import type { DatabaseAdapter } from 'payload'

/**
 * The subset of a drizzle-kit schema snapshot (`generateDrizzleJson` /
 * `generateSQLiteDrizzleJson` output) needed to know which objects the code
 * schema wants. Values carry their database names; record keys are internal
 * snapshot keys and must not be used.
 */
export interface DrizzleSnapshot {
  enums?: Record<string, { name: string; schema?: string }>
  tables: Record<
    string,
    { columns: Record<string, { name: string }>; name: string; schema?: string }
  >
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

/** table name -> set of column names, for tables in the adapter's schema. */
const codeTableColumns = (
  snapshot: DrizzleSnapshot,
  schemaName?: string,
): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>()
  for (const table of Object.values(snapshot.tables)) {
    if (schemaName !== undefined && (table.schema || 'public') !== schemaName) {
      continue
    }
    result.set(table.name, new Set(Object.values(table.columns).map((column) => column.name)))
  }
  return result
}

const codeEnumNames = (snapshot: DrizzleSnapshot, schemaName: string): Set<string> =>
  new Set(
    Object.values(snapshot.enums ?? {})
      .filter((item) => (item.schema || 'public') === schemaName)
      .map((item) => item.name),
  )

/** Live tables (with their columns) and enum types, per dialect. */
interface LiveSchemaState {
  enums: Set<string>
  tables: Map<string, Set<string>>
}

const setDiff = (a: Iterable<string>, b: Set<string>): string[] =>
  [...a].filter((item) => !b.has(item)).sort()

/**
 * Report the rename-shaped ambiguities drizzle-kit's push would stop and
 * prompt on: object kinds (tables, per-table columns, enum types) where the
 * diff against the code schema contains BOTH created and deleted entries —
 * indistinguishable from a rename without human input. Purely additive or
 * purely destructive drift is NOT reported: drizzle's resolvers pass those
 * through without prompting, so the push can run headless.
 *
 * Returns human-readable descriptions (empty = the reconcile is safe to run).
 */
export const detectRenameAmbiguities = async (
  targetAdapter: DatabaseAdapter,
  snapshot: DrizzleSnapshot,
): Promise<string[]> => {
  let live: LiveSchemaState
  let codeTables: Map<string, Set<string>>
  let codeEnums: Set<string>

  if (targetAdapter.name === 'postgres') {
    const adapter = targetAdapter as unknown as { pool: PgPoolLike; schemaName?: string }
    const schemaName = adapter.schemaName || 'public'
    live = await getLivePostgresState(adapter.pool, schemaName)
    codeTables = codeTableColumns(snapshot, schemaName)
    codeEnums = codeEnumNames(snapshot, schemaName)
  } else if (targetAdapter.name === 'sqlite') {
    const client = (targetAdapter as unknown as { client: LibSqlClientLike }).client
    live = await getLiveSqliteState(client)
    codeTables = codeTableColumns(snapshot)
    codeEnums = new Set()
  } else {
    return []
  }

  const ambiguities: string[] = []

  const liveTableNames = new Set(live.tables.keys())
  const codeTableNames = new Set(codeTables.keys())
  const deletedTables = setDiff(liveTableNames, codeTableNames)
  const createdTables = setDiff(codeTableNames, liveTableNames)
  if (deletedTables.length > 0 && createdTables.length > 0) {
    ambiguities.push(
      `tables: removed [${deletedTables.join(', ')}] vs added [${createdTables.join(', ')}]`,
    )
  }

  for (const [table, liveColumns] of live.tables) {
    const codeColumns = codeTables.get(table)
    if (!codeColumns) {
      continue
    }
    const deleted = setDiff(liveColumns, codeColumns)
    const created = setDiff(codeColumns, liveColumns)
    if (deleted.length > 0 && created.length > 0) {
      ambiguities.push(
        `table "${table}": removed columns [${deleted.join(', ')}] vs added [${created.join(', ')}]`,
      )
    }
  }

  const deletedEnums = setDiff(live.enums, codeEnums)
  const createdEnums = setDiff(codeEnums, live.enums)
  if (deletedEnums.length > 0 && createdEnums.length > 0) {
    ambiguities.push(
      `enum types: removed [${deletedEnums.join(', ')}] vs added [${createdEnums.join(', ')}]`,
    )
  }

  return ambiguities
}

interface PgPoolLike {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

/**
 * Live base tables/columns and enum types in the adapter's schema, excluding
 * extension members (e.g. postgis's spatial_ref_sys) — those belong to CREATE
 * EXTENSION, not to the code schema.
 */
const getLivePostgresState = async (
  pool: PgPoolLike,
  schemaName: string,
): Promise<LiveSchemaState> => {
  const liveColumns = await pool.query(
    `SELECT c.relname AS table_name, a.attname AS column_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attribute a
       ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = $1 AND c.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
           AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
       )
     ORDER BY c.relname, a.attnum`,
    [schemaName],
  )
  const tables = new Map<string, Set<string>>()
  for (const row of liveColumns.rows) {
    const table = String(row.table_name)
    const columns = tables.get(table) ?? new Set()
    if (row.column_name != null) {
      columns.add(String(row.column_name))
    }
    tables.set(table, columns)
  }

  const liveEnums = await pool.query(
    `SELECT DISTINCT t.typname AS name
     FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE n.nspname = $1
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
         WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid
           AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
       )
     ORDER BY t.typname`,
    [schemaName],
  )
  const enums = new Set(liveEnums.rows.map((row) => String(row.name)))

  return { enums, tables }
}

interface LibSqlClientLike {
  execute: (
    stmt: { args: unknown[]; sql: string } | string,
  ) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const isSqliteSystemObject = (name: string) =>
  name.startsWith('sqlite_') || name === 'libsql_wasm_func_table'

const getLiveSqliteState = async (client: LibSqlClientLike): Promise<LiveSchemaState> => {
  const liveTables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL",
  )
  const tables = new Map<string, Set<string>>()
  for (const row of liveTables.rows) {
    const table = String(row.name)
    if (isSqliteSystemObject(table)) {
      continue
    }
    const info = await client.execute(`PRAGMA table_info(${quoteIdent(table)})`)
    tables.set(table, new Set(info.rows.map((infoRow) => String(infoRow.name))))
  }
  return { enums: new Set(), tables }
}

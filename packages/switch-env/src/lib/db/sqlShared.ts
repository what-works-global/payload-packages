import type { BasePayload, DatabaseAdapter } from 'payload'

import type { CopyConfig } from '../../types.js'
import type { DrizzleSnapshot } from './renameAmbiguity.js'

import { detectRenameAmbiguities } from './renameAmbiguity.js'

export interface SqlBackupData {
  /**
   * The `payload_migrations` rows from the source so the target knows where it
   * sits in the migration timeline.
   */
  migrations: Record<string, unknown>[]
  /**
   * DDL statements captured from the source database, in the order they should
   * be re-applied to the target: `sqlite_master` SQL on SQLite, catalog
   * introspection (enums, sequences, tables, constraints, indexes) on Postgres.
   * Replaying these recreates the SOURCE's schema on the target — even when the
   * target's code schema has progressed past it — so the source rows always fit.
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

export interface RestoreSqlResult {
  /**
   * Non-empty when the final dev-schema reconcile was paused because of
   * rename-shaped ambiguity: the target holds a pure production replica plus
   * applied migrations, and these entries describe the created-vs-deleted
   * pairs. Resolving them requires either a migration file for the rename, or
   * (in development) a dev server restart so Payload's own boot-time push can
   * prompt in the terminal.
   */
  deferredReconcile: string[]
}

export const PAYLOAD_MIGRATIONS_TABLE = 'payload_migrations'

/** The drizzle-kit `pushSchema` result (see schemaDrift.ts for field notes). */
interface PushSchemaResult {
  apply: () => Promise<unknown>
  hasDataLoss?: boolean
  statementsToExecute?: string[]
  warnings?: string[]
}

type PushSchemaFn = (
  schema: unknown,
  drizzle: unknown,
  schemaFilters?: string[],
  tablesFilter?: unknown,
  extensionsFilter?: string[],
) => Promise<PushSchemaResult>

/**
 * drizzle-kit's API as re-exported by the Payload adapters' requireDrizzleKit.
 * `generateDrizzleJson` is sync on Postgres and async on SQLite
 * (generateSQLiteDrizzleJson) — always await it.
 */
interface DrizzleKitApi {
  generateDrizzleJson: (schema: unknown) => DrizzleSnapshot | Promise<DrizzleSnapshot>
  pushSchema: PushSchemaFn
}

interface DrizzleAdapterLike {
  drizzle: {
    insert: (table: unknown) => { values: (row: Record<string, unknown>) => Promise<unknown> }
  }
  execute: (args: {
    drizzle: unknown
    raw: string
  }) => Promise<{ rows: Array<Record<string, unknown>> }>
  extensions?: { postgis?: boolean }
  requireDrizzleKit: () => DrizzleKitApi
  schema: unknown
  schemaName?: string
  tables: Record<string, unknown>
  tablesFilter?: unknown
}

/**
 * Resolve drizzle-kit's API through the adapter's own `requireDrizzleKit`.
 * Called as a preflight before any destructive restore step: if drizzle-kit
 * can't be resolved, the restore must abort while the target database is still
 * intact.
 */
export const requireDrizzleKitApi = (targetAdapter: DatabaseAdapter): DrizzleKitApi => {
  const adapter = targetAdapter as unknown as DrizzleAdapterLike
  if (typeof adapter.requireDrizzleKit !== 'function') {
    throw new Error('[switch-env] expected a Drizzle adapter exposing requireDrizzleKit')
  }
  try {
    return adapter.requireDrizzleKit()
  } catch (cause) {
    throw new Error(
      '[switch-env] could not resolve drizzle-kit, which is required when using a SQL ' +
        'database adapter. It ships with @payloadcms/db-postgres / @payloadcms/db-sqlite.',
      { cause },
    )
  }
}

/**
 * True when `statement` is a DROP VIEW that Postgres rejected because the view
 * is owned by an installed extension (SQLSTATE 2BP01, dependent objects). The
 * driver error arrives wrapped (drizzle re-throws with the original as
 * `cause`), so walk the cause chain for the code.
 */
const isUndroppableExtensionView = (statement: string, error: unknown): boolean => {
  if (!/^\s*DROP\s+(?:MATERIALIZED\s+)?VIEW\b/i.test(statement)) {
    return false
  }
  for (
    let cause: unknown = error;
    typeof cause === 'object' && cause !== null;
    cause = (cause as { cause?: unknown }).cause
  ) {
    if ((cause as { code?: unknown }).code === '2BP01') {
      return true
    }
  }
  return false
}

/**
 * Non-interactive equivalent of @payloadcms/drizzle's `pushDevSchema`:
 * reconcile the adapter's code-defined schema against the live target database
 * and record the push with a `batch = -1` "dev" row in `payload_migrations`.
 *
 * `pushDevSchema` itself is unusable here: when the diff carries warnings —
 * exactly what reconciling a restored production schema past a local rename or
 * column removal produces — it prompts on stdin via `prompts` and calls
 * `process.exit(0)` on decline/cancel. Inside a copy endpoint that means a
 * hidden interactive prompt at best and killing the dev server at worst. The
 * restore has just deliberately wiped and reloaded a development database, so
 * data-loss warnings are expected: log them and apply.
 *
 * Calling drizzle-kit's `pushSchema` directly also sidesteps `pushDevSchema`'s
 * module-scoped previous-schema cache (no PAYLOAD_FORCE_DRIZZLE_PUSH juggling).
 *
 * The warnings prompt is not the only interactive surface: drizzle-kit's diff
 * resolvers prompt on stdin whenever created and deleted objects of the same
 * kind coexist — a possible rename, unanswerable without a human. If any such
 * pair exists, the reconcile PAUSES: it returns the pairs without touching the
 * schema, leaving the target a pure production replica (plus applied
 * migrations). The resolution is a migration file for the rename, or — in
 * development — a dev server restart, where Payload's own boot-time push runs
 * drizzle's rename prompt in the terminal. Purely additive or purely
 * destructive drift never pauses: drizzle's resolvers pass it through without
 * prompting, so the push runs headless (deletions surface as logged warnings).
 */
export const applyDevSchema = async (
  targetAdapter: DatabaseAdapter,
  logger?: BasePayload['logger'],
): Promise<RestoreSqlResult> => {
  const adapter = targetAdapter as unknown as DrizzleAdapterLike
  const { generateDrizzleJson, pushSchema } = requireDrizzleKitApi(targetAdapter)
  const { extensions = {}, tablesFilter } = adapter

  const snapshot = await generateDrizzleJson(adapter.schema)

  const ambiguities = await detectRenameAmbiguities(targetAdapter, snapshot)
  if (ambiguities.length > 0) {
    logger?.warn(
      `[switch-env] schema reconcile paused — possible rename(s) detected:\n${ambiguities.join('\n')}\n` +
        'The development database was left as a production replica. Add a migration for the ' +
        'rename, or (in development) restart the dev server to resolve interactively.',
    )
    return { deferredReconcile: ambiguities }
  }

  const result = await pushSchema(
    adapter.schema,
    adapter.drizzle,
    adapter.schemaName ? [adapter.schemaName] : undefined,
    tablesFilter,
    extensions.postgis ? ['postgis'] : undefined,
  )

  const warnings = result.warnings ?? []
  if (warnings.length > 0) {
    logger?.warn(
      `[switch-env] applying dev schema push with warnings${
        result.hasDataLoss ? ' (data loss on the development database)' : ''
      }:\n${warnings.join('\n')}`,
    )
  }
  // Run the statements ourselves instead of result.apply() to smooth over two
  // drizzle-kit push generation warts that only surface on destructive diffs:
  //
  // - SQLite: a recreated table's CREATE INDEX statements are emitted twice
  //   (once by the table-recreate flow, once by the index diff) and the
  //   duplicate fails with "index already exists". Duplicate DDL in a push
  //   list is never intentional — execute each distinct statement once.
  // - Postgres: a dropped table is emitted as DROP TABLE ... CASCADE, which
  //   already removes other tables' FK constraints on it — but the diff ALSO
  //   emits an explicit DROP CONSTRAINT for those, which then fails with
  //   "does not exist". The desired end state is absence, so make DROP
  //   CONSTRAINT / DROP INDEX clauses idempotent with IF EXISTS.
  // - Postgres: a view owned by an installed extension (pg_stat_statements
  //   lands in `public` wherever CREATE EXTENSION ran without a SCHEMA clause,
  //   e.g. RDS) is diffed as unknown and emitted as DROP VIEW — which Postgres
  //   refuses with 2BP01 ("extension ... requires it"). No push can ever drop
  //   it; skip the statement and leave the view, invisible to Payload.
  const statements = result.statementsToExecute
  if (statements === undefined) {
    await result.apply()
  } else {
    const seen = new Set<string>()
    for (const statement of statements) {
      if (seen.has(statement)) {
        continue
      }
      seen.add(statement)
      const idempotent = statement
        .replace(/\bDROP CONSTRAINT\s+(?!IF\s+EXISTS\b)/i, 'DROP CONSTRAINT IF EXISTS ')
        .replace(/\bDROP INDEX\s+(?!IF\s+EXISTS\b)/i, 'DROP INDEX IF EXISTS ')
      try {
        await adapter.execute({ drizzle: adapter.drizzle, raw: idempotent })
      } catch (error) {
        if (!isUndroppableExtensionView(idempotent, error)) {
          throw error
        }
        logger?.warn(
          `[switch-env] skipped \`${idempotent.trim()}\` — the view belongs to an installed extension and cannot be dropped by a schema push`,
        )
      }
    }
  }

  // Mirror pushDevSchema's bookkeeping: upsert the batch = -1 "dev" row so
  // Payload knows this database is managed by push. Insert through drizzle so
  // the payload_migrations $defaultFn timestamps are populated.
  const migrationsTable = adapter.schemaName
    ? `"${adapter.schemaName}"."${PAYLOAD_MIGRATIONS_TABLE}"`
    : `"${PAYLOAD_MIGRATIONS_TABLE}"`
  const existing = await adapter.execute({
    drizzle: adapter.drizzle,
    raw: `SELECT * FROM ${migrationsTable} WHERE batch = '-1'`,
  })
  if (existing.rows.length === 0) {
    await adapter.drizzle
      .insert(adapter.tables[PAYLOAD_MIGRATIONS_TABLE])
      .values({ name: 'dev', batch: -1 })
  } else {
    await adapter.execute({
      drizzle: adapter.drizzle,
      raw: `UPDATE ${migrationsTable} SET updated_at = CURRENT_TIMESTAMP WHERE batch = '-1'`,
    })
  }

  return { deferredReconcile: [] }
}

/**
 * Apply any pending migration files on disk (e.g. renames the dev wrote but the
 * target hasn't run yet). `payload.db.migrate` is what Payload itself calls for
 * `payload migrate`; it reads from `db.migrationDir`. Skipped when there's no
 * `migrationDir` on disk — `readMigrationFiles` logs an ERROR in that case even
 * though it gracefully returns `[]`.
 *
 * Best-effort by design: `db.migrate` dynamically `import()`s each on-disk
 * migration file, and Payload's generated migrations import types as values
 * (`import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-*'`).
 * Outside Payload's own CLI (which transpiles first) the Node ESM loader can't
 * resolve those type-only names — they aren't real runtime exports — so the
 * import throws with e.g. `does not provide an export named 'MigrateDownArgs'`.
 * The copy doesn't need migrations to succeed: the caller reconciles the dev
 * schema with `applyDevSchema` immediately afterwards, so a load failure is
 * logged and swallowed rather than aborting a copy whose data is already loaded.
 */
export const runPendingMigrations = async (
  targetAdapter: DatabaseAdapter,
  migrationDirExists: (dir: string) => boolean,
  logger?: BasePayload['logger'],
): Promise<void> => {
  const migrationDir = (targetAdapter as unknown as { migrationDir?: string }).migrationDir
  const migrate = (targetAdapter as unknown as { migrate?: () => Promise<void> }).migrate
  if (typeof migrate !== 'function' || !migrationDir || !migrationDirExists(migrationDir)) {
    return
  }
  try {
    await migrate.call(targetAdapter)
  } catch (error) {
    logger?.warn(
      { err: error },
      '[switch-env] could not apply on-disk migration files during copy; continuing with a ' +
        'dev schema push instead. This is expected when migration files import types from the ' +
        'database adapter (the runtime ESM loader cannot resolve type-only imports) and is safe ' +
        'for a development copy — the schema is reconciled by the push that follows.',
    )
  }
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

export const rowToObject = (
  row: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> => {
  const obj: Record<string, unknown> = {}
  for (const column of columns) {
    obj[column] = row[column]
  }
  return obj
}

export interface BaseTableMode {
  mode: 'all' | 'latest-x' | 'none'
  /** Only set when mode === 'latest-x'. */
  x: number
}

export interface VersionTableMode {
  /** Coerced from CopyVersionsMode — 'none' becomes latest-x:1 to match mongo. */
  mode: 'all' | 'latest-x'
  x: number
}

export const resolveSqlBaseTableName = (config: {
  dbName?: ((args: Record<string, never>) => string) | string
  slug: string
}): string => {
  if (typeof config.dbName === 'function') {
    return config.dbName({})
  }
  if (typeof config.dbName === 'string' && config.dbName.length > 0) {
    return config.dbName
  }
  // Payload converts kebab-case slugs to snake_case table names in its SQL adapters.
  return config.slug.replace(/-/g, '_')
}

const coerceBaseMode = (
  mode: { mode: 'all' } | { mode: 'latest-x'; x: number } | { mode: 'none' } | undefined,
): BaseTableMode => {
  if (!mode) {
    return { mode: 'all', x: 0 }
  }
  if (mode.mode === 'latest-x') {
    return { mode: 'latest-x', x: mode.x }
  }
  return { mode: mode.mode, x: 0 }
}

const coerceVersionMode = (
  mode: { mode: 'all' } | { mode: 'latest-x'; x: number } | { mode: 'none' } | undefined,
): VersionTableMode => {
  if (!mode || mode.mode === 'all') {
    return { mode: 'all', x: 0 }
  }
  // 'none' means "only the latest version per parent" — mirrors the mongo coercion in copyUtils.
  if (mode.mode === 'none') {
    return { mode: 'latest-x', x: 1 }
  }
  return { mode: 'latest-x', x: mode.x }
}

export const resolveBaseTableModes = (
  payload: BasePayload,
  copyConfig: CopyConfig | undefined,
): Record<string, BaseTableMode> => {
  const result: Record<string, BaseTableMode> = {}
  const documentsConfig = copyConfig?.documents ?? {}
  const defaultMode = coerceBaseMode(documentsConfig.default)

  for (const collection of payload.config.collections ?? []) {
    const tableName = resolveSqlBaseTableName(collection)
    const override = documentsConfig.collections?.[collection.slug]
    result[tableName] = override ? coerceBaseMode(override) : defaultMode
  }
  for (const global of payload.config.globals ?? []) {
    const tableName = resolveSqlBaseTableName(global)
    const override = documentsConfig.globals?.[global.slug]
    result[tableName] = override ? coerceBaseMode(override) : defaultMode
  }
  return result
}

export const resolveVersionTableModes = (
  payload: BasePayload,
  copyConfig: CopyConfig | undefined,
): Record<string, VersionTableMode> => {
  const result: Record<string, VersionTableMode> = {}
  const versionsConfig = copyConfig?.versions ?? {}
  const defaultMode = coerceVersionMode(versionsConfig.default)

  for (const collection of payload.config.collections ?? []) {
    if (!collection.versions) {
      continue
    }
    const base = resolveSqlBaseTableName(collection)
    const override = versionsConfig.collections?.[collection.slug]
    result[`_${base}_v`] = override ? coerceVersionMode(override) : defaultMode
  }
  for (const global of payload.config.globals ?? []) {
    if (!global.versions) {
      continue
    }
    const base = resolveSqlBaseTableName(global)
    const override = versionsConfig.globals?.[global.slug]
    result[`_${base}_v`] = override ? coerceVersionMode(override) : defaultMode
  }
  return result
}

const toNumeric = (v: unknown): number => {
  if (typeof v === 'number') {
    return v
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0
  }
  if (typeof v === 'bigint') {
    return Number(v)
  }
  return 0
}

const toSortableString = (v: unknown): string => {
  if (typeof v === 'string') {
    return v
  }
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v)
  }
  // Postgres returns timestamp columns as Date objects (SQLite returns strings).
  // Compare them by their ISO representation so latest-x ordering is correct on
  // both adapters.
  if (v instanceof Date) {
    return v.toISOString()
  }
  return ''
}

export const filterLatestXRows = (
  rows: Record<string, unknown>[],
  x: number,
): Record<string, unknown>[] => {
  if (rows.length === 0 || x < 1) {
    return []
  }
  const sorted = [...rows].sort((a, b) => {
    const aUpd = toSortableString(a.updated_at)
    const bUpd = toSortableString(b.updated_at)
    if (aUpd !== bUpd) {
      return aUpd < bUpd ? 1 : -1
    }
    const aId = toSortableString(a.id)
    const bId = toSortableString(b.id)
    return aId < bId ? 1 : -1
  })
  return sorted.slice(0, x)
}

export const filterLatestXPerParent = (
  rows: Record<string, unknown>[],
  x: number,
): Record<string, unknown>[] => {
  if (rows.length === 0 || x < 1) {
    return []
  }
  // Sort descending by (latest, updated_at, id). Mirrors the mongo path which
  // prioritizes latest=true so list views in the target admin still find docs.
  const sorted = [...rows].sort((a, b) => {
    const latestDiff = toNumeric(b.latest) - toNumeric(a.latest)
    if (latestDiff !== 0) {
      return latestDiff
    }
    const aUpd = toSortableString(a.updated_at)
    const bUpd = toSortableString(b.updated_at)
    if (aUpd !== bUpd) {
      return aUpd < bUpd ? 1 : -1
    }
    const aId = toSortableString(a.id)
    const bId = toSortableString(b.id)
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

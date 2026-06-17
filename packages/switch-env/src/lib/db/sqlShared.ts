import type { pushDevSchema } from '@payloadcms/drizzle'
import type { BasePayload, DatabaseAdapter } from 'payload'

import type { CopyConfig } from '../../types.js'

export interface SqlBackupData {
  /**
   * The `payload_migrations` rows from the source so the target knows where it
   * sits in the migration timeline.
   */
  migrations: Record<string, unknown>[]
  /**
   * CREATE TABLE / CREATE INDEX statements captured from the source schema, in
   * the order they should be re-applied to the target. Only the SQLite (libSQL)
   * path populates this — the Postgres path materializes the schema with
   * `pushDevSchema` instead, so it leaves this empty.
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

export const PAYLOAD_MIGRATIONS_TABLE = 'payload_migrations'

/**
 * `@payloadcms/drizzle` is an optional peer dependency — Mongo consumers don't
 * install it, so it must never be imported at module load time. Resolve it
 * lazily and only on the SQL restore path.
 */
export const importPushDevSchema = async (): Promise<typeof pushDevSchema> => {
  try {
    const drizzle = await import('@payloadcms/drizzle')
    return drizzle.pushDevSchema
  } catch (cause) {
    throw new Error(
      '[switch-env] could not import @payloadcms/drizzle, which is required when using a SQL ' +
        'database adapter. Install it alongside your @payloadcms/db-* adapter.',
      { cause },
    )
  }
}

/**
 * Run Drizzle's dev schema push against the live adapter. The `previousSchema`
 * cache inside `pushDevSchema` can silently no-op a second push in a process —
 * `PAYLOAD_FORCE_DRIZZLE_PUSH=true` is the documented bypass — so force it on
 * and restore the prior value afterwards.
 */
export const forcePushDevSchema = async (
  pushDevSchemaFn: typeof pushDevSchema,
  targetAdapter: DatabaseAdapter,
): Promise<void> => {
  const previousForce = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  try {
    await pushDevSchemaFn(targetAdapter as unknown as Parameters<typeof pushDevSchema>[0])
  } finally {
    if (previousForce === undefined) {
      delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH
    } else {
      process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = previousForce
    }
  }
}

/**
 * Apply any pending migration files on disk (e.g. renames the dev wrote but the
 * target hasn't run yet). `payload.db.migrate` is what Payload itself calls for
 * `payload migrate`; it reads from `db.migrationDir`. Skipped when there's no
 * `migrationDir` on disk — `readMigrationFiles` logs an ERROR in that case even
 * though it gracefully returns `[]`.
 */
export const runPendingMigrations = async (
  targetAdapter: DatabaseAdapter,
  migrationDirExists: (dir: string) => boolean,
): Promise<void> => {
  const migrationDir = (targetAdapter as unknown as { migrationDir?: string }).migrationDir
  const migrate = (targetAdapter as unknown as { migrate?: () => Promise<void> }).migrate
  if (typeof migrate === 'function' && migrationDir && migrationDirExists(migrationDir)) {
    await migrate.call(targetAdapter)
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

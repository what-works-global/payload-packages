import type { DatabaseAdapter } from 'payload'

/**
 * The drizzle-kit `pushSchema` result. Payload's own `pushDevSchema` only reads
 * `{ apply, hasDataLoss, warnings }`, but the underlying object also carries
 * `statementsToExecute` — the DDL that *would* run. `warnings` only covers
 * destructive/ambiguous changes, so an additive change (e.g. a new nullable
 * column) produces zero warnings but a non-empty `statementsToExecute`. We rely
 * on `statementsToExecute` to detect any drift at all.
 */
interface PushSchemaResult {
  apply: () => Promise<unknown>
  hasDataLoss?: boolean
  statementsToExecute?: string[]
  warnings?: string[]
}

interface DrizzleAdapterLike {
  drizzle: unknown
  extensions?: { postgis?: boolean }
  requireDrizzleKit: () => {
    pushSchema: (
      schema: unknown,
      drizzle: unknown,
      schemaFilters?: string[],
      tablesFilter?: unknown,
      extensionsFilter?: string[],
    ) => Promise<PushSchemaResult>
  }
  schema: unknown
  schemaName?: string
  tablesFilter?: unknown
}

export interface SchemaDrift {
  hasDataLoss: boolean
  statements: string[]
  warnings: string[]
}

/**
 * Dry-run schema diff for Drizzle (SQLite/Postgres) adapters: computes the DDL
 * that would be required to make `targetAdapter`'s live database match
 * `schemaAdapter`'s code-defined schema — WITHOUT applying anything.
 *
 * `apply()` from the underlying push is intentionally never called, so this is a
 * pure read/introspection against the target database.
 */
export const getSqlSchemaDrift = async ({
  schemaAdapter,
  targetAdapter,
}: {
  schemaAdapter: DatabaseAdapter
  targetAdapter: DatabaseAdapter
}): Promise<SchemaDrift> => {
  const source = schemaAdapter as unknown as DrizzleAdapterLike
  const target = targetAdapter as unknown as DrizzleAdapterLike

  const { pushSchema } = source.requireDrizzleKit()
  const { extensions = {}, tablesFilter } = source

  // Mirrors the argument shape used by @payloadcms/drizzle's pushDevSchema, but
  // introspects the TARGET database while diffing against the SOURCE schema.
  const result = await pushSchema(
    source.schema,
    target.drizzle,
    source.schemaName ? [source.schemaName] : undefined,
    tablesFilter,
    extensions.postgis ? ['postgis'] : undefined,
  )

  return {
    hasDataLoss: Boolean(result.hasDataLoss),
    statements: result.statementsToExecute ?? [],
    warnings: result.warnings ?? [],
  }
}

// drizzle-kit emits one statement per index DDL: `CREATE [UNIQUE] INDEX ...` or
// `DROP INDEX ...`. Anything else (ALTER TABLE, CREATE TABLE, ...) is genuine
// schema drift we must never silence.
const INDEX_DDL = /^\s*(?:drop\s+index|create\s+(?:unique\s+)?index)\b/i

// Match an index name as a whole identifier regardless of how the dialect quotes
// it (SQLite backticks, Postgres double quotes, optional schema qualification).
const referencesIdentifier = (statement: string, name: string): boolean => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(statement)
}

// Reconstruct the index name @payloadcms/drizzle's buildIndexName would generate
// for `base` in the common (no-collision) case: append `_idx`, truncating the
// base when the result would exceed drizzle's 60-char identifier budget.
const reshapeIndexName = (base: string): string => {
  const suffix = '_idx'
  if (base.length + suffix.length > 60) {
    return `${base.slice(0, 60 - suffix.length)}${suffix}`
  }
  return `${base}${suffix}`
}

/**
 * Remove the development-only filename-uniqueness reshape this plugin injects
 * from a drift result, so the switch-to-production gate only blocks on genuine
 * *user* schema changes.
 *
 * In development cloud-storage mode the plugin sets `upload.filenameCompoundIndex`
 * on prefixed upload collections, so the live schema carries a compound
 * `unique(filename, prefix)` index where production (built from migrations, which
 * suppress the compound index — see isGeneratingMigration) only has the default
 * single-field `unique(filename)`. A dry-run diff of the live schema against
 * production therefore reports that reshape as three index statements:
 *
 *   DROP INDEX <table>_filename_idx;
 *   CREATE UNIQUE INDEX <table>_filename_compound_idx ON <table> (filename, prefix);
 *   CREATE INDEX <table>_filename_idx ON <table> (filename);
 *
 * That is not user drift — it is the plugin's own dev-only reshape, and no
 * migration can clear it (one would push the compound index to production, which
 * is exactly what must not happen). Left in, it would permanently block
 * switching back to production on SQL adapters. Strip those statements out.
 *
 * Safe because drift is differences-only: a filename index that legitimately
 * existed in both environments (same migrations) produces no statement, so the
 * only filename-index difference that can appear is the one the plugin caused.
 * Restricted to index DDL referencing exactly the two reshape index names of a
 * collection we know we reshaped — never touches column/table drift.
 */
export const excludeFilenameIndexReshape = (
  drift: SchemaDrift,
  reshapedTableNames: string[],
): SchemaDrift => {
  if (reshapedTableNames.length === 0) {
    return drift
  }
  const reshapeNames = new Set<string>()
  for (const table of reshapedTableNames) {
    reshapeNames.add(reshapeIndexName(`${table}_filename`))
    reshapeNames.add(reshapeIndexName(`${table}_filename_compound`))
  }
  const statements = drift.statements.filter((statement) => {
    if (!INDEX_DDL.test(statement)) {
      return true
    }
    return ![...reshapeNames].some((name) => referencesIdentifier(statement, name))
  })
  return {
    // The reshape is purely additive (no data loss). Once it is the only thing
    // left, there is nothing for the gate to flag.
    hasDataLoss: statements.length === 0 ? false : drift.hasDataLoss,
    statements,
    warnings: drift.warnings,
  }
}

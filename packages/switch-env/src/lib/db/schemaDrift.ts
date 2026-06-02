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

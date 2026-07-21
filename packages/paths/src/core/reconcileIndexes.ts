import type { Payload } from 'payload'

import type { ResolvedPathsPluginConfig } from '../types.js'
import type { ResolvedPathsCollection } from './shared.js'

/** The MongoDB driver Collection methods we touch (feature-detected). */
type MongoCollectionLike = {
  dropIndex: (name: string) => Promise<unknown>
  indexes: () => Promise<MongoIndexInfo[]>
}

type MongoIndexInfo = { key?: Record<string, number>; name?: string; unique?: boolean }

/** Stable key for a set of field names, order-independent. */
const fieldSetKey = (fields: string[]): string => [...fields].sort().join('\0')

/**
 * The native MongoDB collection for a slug on the mongoose adapter, or `null`
 * on any other adapter. Uses the mongoose *model's* collection (not
 * `connection.collection(slug)`), so it respects mongoose auto-pluralization
 * and `dbName` overrides. Feature-detected — no hard dependency on
 * `@payloadcms/db-mongodb`.
 */
const getMongoCollection = (payload: Payload, slug: string): MongoCollectionLike | null => {
  const db = payload.db as unknown as {
    collections?: Record<string, { collection?: unknown } | undefined>
    name?: string
  }
  // SQL (Drizzle) and any non-mongoose adapter: skip. See reconcileSlugIndexes.
  if (db.name !== 'mongoose') {
    return null
  }
  const candidate = db.collections?.[slug]?.collection
  if (
    candidate &&
    typeof (candidate as MongoCollectionLike).indexes === 'function' &&
    typeof (candidate as MongoCollectionLike).dropIndex === 'function'
  ) {
    return candidate as MongoCollectionLike
  }
  return null
}

/**
 * The set of unique-index field-sets the CURRENT config still wants: field-level
 * `unique: true` fields (single-field) plus `collection.indexes` entries marked
 * `unique`. A DB unique index whose field-set is absent here is drift.
 */
const wantedUniqueFieldSets = (
  payload: Payload,
  resolved: ResolvedPathsCollection,
): Set<string> => {
  const config = payload.collections?.[resolved.slug]?.config
  const wanted = new Set<string>()
  for (const field of config?.flattenedFields ?? []) {
    if ('unique' in field && field.unique && 'name' in field && typeof field.name === 'string') {
      wanted.add(fieldSetKey([field.name]))
    }
  }
  const configIndexes = (config as { indexes?: { fields?: string[]; unique?: boolean }[] })?.indexes
  for (const index of configIndexes ?? []) {
    if (index.unique && Array.isArray(index.fields)) {
      wanted.add(fieldSetKey(index.fields))
    }
  }
  return wanted
}

/** A stale unique index found on a collection: its name and indexed fields. */
export type StaleUniqueIndex = { fields: string[]; name: string }

/**
 * The stale UNIQUE indexes on one collection's slug that {@link
 * reconcileSlugIndexes} would drop — a single-field `<slug>` index, or a
 * compound `{ <scope>, <slug> }` one, that the current config no longer
 * declares. Detection only (never drops); `[]` on non-mongo adapters or when
 * the collection has no such drift. Powers both the boot-time drop and the
 * adoption preflight's report.
 */
export const findStaleSlugUniqueIndexes = async (
  payload: Payload,
  resolved: ResolvedPathsCollection,
): Promise<StaleUniqueIndex[]> => {
  const mongoCollection = getMongoCollection(payload, resolved.slug)
  if (!mongoCollection) {
    return []
  }

  const slugRelatedSets = new Set<string>([fieldSetKey([resolved.slugField])])
  if (resolved.scopeField) {
    slugRelatedSets.add(fieldSetKey([resolved.scopeField, resolved.slugField]))
  }
  const wanted = wantedUniqueFieldSets(payload, resolved)

  let indexes: MongoIndexInfo[]
  try {
    indexes = await mongoCollection.indexes()
  } catch {
    // Collection not created yet (fresh DB) — nothing to reconcile.
    return []
  }

  const stale: StaleUniqueIndex[] = []
  for (const index of indexes) {
    if (!index.unique || !index.name || index.name === '_id_') {
      continue
    }
    const fields = Object.keys(index.key ?? {})
    const keySet = fieldSetKey(fields)
    if (slugRelatedSets.has(keySet) && !wanted.has(keySet)) {
      stale.push({ name: index.name, fields })
    }
  }
  return stale
}

/**
 * Drop legacy UNIQUE indexes on a paths collection's slug that the current
 * config no longer declares — either a single-field `<slug>` index (the
 * unique-slug → stored-`path` migration) or a compound `{ <scope>, <slug> }`
 * index (the multi-tenant equivalent, where per-scope uniqueness moved to
 * `{ scope, path }`).
 *
 * Why this exists: mongoose's `ensureIndexes` only ever *creates* indexes — it
 * never drops one that no longer matches the schema. So on existing databases
 * the old unique index lingers and keeps rejecting the duplicate slugs the
 * plugin is meant to allow (`/about/contact` next to `/contact`, or the same
 * slug across two tenants). This is the boot-time equivalent of a hand-written
 * "drop the unique slug index" migration, so consumers never copy one into
 * every project.
 *
 * Adapter behavior:
 * - **Mongo (mongoose)** — the only adapter that needs this; the drift is
 *   dropped here on boot (idempotent: once gone, later boots find nothing).
 * - **SQL (Postgres/SQLite via Drizzle)** — a no-op. Drizzle reconciles the
 *   changed constraint itself: dev `push` drops it automatically, and
 *   production `payload migrate:create` emits the DROP in a generated
 *   migration. Doing raw SQL here would only fight that workflow.
 *
 * Safety: only indexes whose key set is exactly `{ slug }` or `{ scope, slug }`
 * are considered, and only when that same uniqueness is NOT still declared in
 * the config — so a collection that genuinely wants a unique slug (kept
 * `unique: true`) or a unique `{ scope, slug }` (kept in `indexes`) is left
 * alone, as is every unrelated unique index. Never throws: failures are logged
 * and boot continues.
 */
export const reconcileSlugIndexes = async (
  payload: Payload,
  resolvedPlugin: ResolvedPathsPluginConfig,
): Promise<void> => {
  for (const resolved of Object.values(resolvedPlugin.collections)) {
    const mongoCollection = getMongoCollection(payload, resolved.slug)
    if (!mongoCollection) {
      continue
    }

    const stale = await findStaleSlugUniqueIndexes(payload, resolved)
    for (const index of stale) {
      try {
        await mongoCollection.dropIndex(index.name)
        payload.logger.info(
          `[payload-paths] Dropped stale UNIQUE index "${index.name}" on "${resolved.slug}" (${index.fields.join(', ')}) — uniqueness now lives on "path"; duplicate slugs at different paths are allowed.`,
        )
      } catch (error) {
        payload.logger.warn(
          error,
          `[payload-paths] Could not drop stale unique index "${index.name}" on "${resolved.slug}"; duplicate slugs may still be rejected until it is removed manually.`,
        )
      }
    }
  }
}

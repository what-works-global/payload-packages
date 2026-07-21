import type { JsonObject, PayloadRequest } from 'payload'

import type { PathsCache, ResolvedPathsCollection, SharedPathsConfig } from './core/shared.js'

/** Fired whenever a document's stored path (or existence) changes. */
export type PathChangedEvent = {
  collection: string
  /** The document after the change. `null` after a delete. */
  doc: JsonObject | null
  /** Stored (prefix-free) path after the change. `null` when unroutable/deleted. */
  newPath: null | string
  /** Public URL (`prefix + path`) after the change. */
  newUrl: null | string
  operation: 'create' | 'delete' | 'update'
  /** The document before the change, when available. */
  previousDoc?: JsonObject | null
  /** Stored (prefix-free) path before the change. */
  previousPath: null | string
  /** Public URL (`prefix + path`) before the change. */
  previousUrl: null | string
  req: PayloadRequest
}

export type OnPathChanged = (event: PathChangedEvent) => Promise<void> | void

/**
 * What the boot-time repair pass does about documents whose `path` is null
 * (created before the plugin was installed, imported directly into the
 * database, or left stale by a bypassed hook).
 *
 * - `'fix'` — recompute and write the missing paths (via the database adapter,
 *   so no hooks, versions, or revalidation storms fire), then log a summary.
 * - `'check'` — only count and log a warning naming `backfillPaths()`.
 * - `'off'` — do nothing.
 */
export type BackfillMode = 'check' | 'fix' | 'off'

export interface PathsPluginConfig extends SharedPathsConfig {
  /**
   * Boot-time repair of documents with a null `path`. Never fails the boot; a
   * cheap indexed count runs first, so a healthy collection costs one query.
   * @default 'fix'
   */
  backfill?: BackfillMode
  /**
   * At most this many documents are repaired per collection per boot; any
   * remainder is logged and picked up on the next boot (or via
   * `backfillPaths()`).
   * @default 1000
   */
  backfillLimit?: number
  /**
   * Cache the plugin invalidates when paths change. Defaults to a no-op (no
   * caching); Next.js apps should use `nextPathsPlugin` from
   * `@whatworks/payload-paths/next`, which defaults this to the
   * `unstable_cache`/`revalidateTag` adapter.
   */
  cache?: PathsCache
  /**
   * Registers fields and indexes but disables hooks and the backfill, keeping
   * the database schema consistent for migrations.
   * @default false
   */
  disabled?: boolean
  /**
   * On boot, drop a legacy single-field UNIQUE index on a collection's slug
   * when the config no longer declares that field unique — the drift left
   * behind when a collection moves from unique-slug to stored `path`, which
   * mongoose's `ensureIndexes` never cleans up on its own. Without it, existing
   * Mongo databases keep rejecting the duplicate slugs the plugin allows.
   *
   * Mongo only; a no-op on SQL adapters (Drizzle drops the changed constraint
   * via dev `push` and generated migrations). Safe and idempotent: only a
   * single-field unique slug index is touched, and only when the field is
   * non-unique in the config. Set `false` to opt out and manage it yourself.
   * @default true
   */
  dropStaleSlugUniqueIndex?: boolean
  /**
   * When a parent's path changes, its whole subtree is checked for collisions
   * before the save is accepted. Subtrees larger than this skip the pre-flight
   * (with a warning) to keep saves fast.
   * @default 500
   */
  maxCascadePreflight?: number
  /** Called after a document's path changes (including cascaded descendants). */
  onPathChanged?: OnPathChanged | OnPathChanged[]
}

/** Internal resolved view stored on `config.custom.payloadPaths`. */
export type ResolvedPathsPluginConfig = {
  backfill: BackfillMode
  backfillLimit: number
  cache: PathsCache
  collections: Record<string, ResolvedPathsCollection>
  dropStaleSlugUniqueIndex: boolean
  maxCascadePreflight: number
  onPathChanged: OnPathChanged[]
}

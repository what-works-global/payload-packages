import type {
  CollectionConfig,
  CollectionSlug,
  DataFromCollectionSlug,
  JsonObject,
  PayloadRequest,
  SelectType,
} from 'payload'

import type { SharedRedirectsConfig } from './core/config.js'
import type { RedirectsCache } from './core/shared.js'

export type RedirectsCollectionConfig<TSlug extends CollectionSlug = CollectionSlug> = {
  /**
   * Resolve a referenced document to the path it lives at (`/about/team`).
   * Runs when the cache is (re)built, with the referenced doc populated one
   * level deep. Return `null`/`undefined` (or throw) to drop redirects
   * pointing at this document from the cache.
   */
  path: (args: {
    doc: DataFromCollectionSlug<TSlug>
    /** The locale the cache is being built for, when the plugin is `localized`. */
    locale?: string
    /** Present when the rebuild runs inside a Payload request (hooks, endpoints). */
    req?: PayloadRequest
  }) => null | string | undefined
  /**
   * Narrow the fields populated on this destination collection during a cache
   * rebuild — fetch only what `path()` needs. Passed to the redirects `find`
   * as `populate: { [slug]: select }`. Defaults to full depth-1 population.
   */
  select?: SelectType
}

/**
 * Collections editors can pick as internal redirect destinations, keyed by
 * slug. Omit (or pass `{}`) to only offer custom URLs.
 */
export type RedirectsCollections = { [K in CollectionSlug]?: RedirectsCollectionConfig<K> }

/** Loosely-typed view of a collection config used internally. */
export type InternalRedirectsCollectionConfig = {
  path: (args: {
    doc: JsonObject
    locale?: string
    req?: PayloadRequest
  }) => null | string | undefined
  select?: SelectType
}

/**
 * Options for `redirectsPlugin`. Extends {@link SharedRedirectsConfig}
 * (`cache`, `endpointsPath`, `secret`, and the serving-only `api`) so one
 * object spreads into both the plugin and the middleware/resolver — the plugin
 * simply ignores `api`.
 */
export interface RedirectsPluginConfig extends SharedRedirectsConfig {
  /**
   * Collections editors can pick as internal redirect destinations. Each
   * entry resolves a referenced doc to its path when the cache is built; a
   * published change that moves a doc (or deletes it) re-syncs the cache
   * automatically.
   */
  collections?: RedirectsCollections
  /**
   * Disables endpoints, hooks, cache syncing, and the init-time cache sync
   * while keeping the redirects collection registered so the database schema
   * stays consistent for migrations.
   * @default false
   */
  disabled?: boolean
  /**
   * Localize `from` and the `to` destination so redirects can differ per
   * locale. Requires `localization` on the Payload config — if absent, the
   * plugin logs a warning and behaves as `false`. The cache is built per
   * locale, and each entry carries its `locale`.
   * @default false
   */
  localized?: boolean
  /** Final say over the generated collection — receives it fully built, returns what ships. */
  overrides?: (args: { collection: CollectionConfig }) => CollectionConfig
  /**
   * Slug of the redirects collection.
   * @default 'redirects'
   */
  slug?: string
  /**
   * Rebuild the cache from the database once on boot (`onInit`), so a freshly
   * started instance serves redirects immediately — without waiting for the
   * first content change or cache-miss refresh. Any existing `onInit` runs
   * first; a sync failure is logged, never fatal. Skipped when `disabled`.
   * @default true
   */
  syncOnInit?: boolean
  /**
   * Track how often (and when last) each redirect was hit: adds read-only
   * `hits`/`lastAccess` sidebar fields and the hit endpoint the middleware
   * reports to.
   * @default true
   */
  trackHits?: boolean
}

export type ResolvedRedirectsConfig = {
  cache: RedirectsCache
  collections: Record<string, InternalRedirectsCollectionConfig>
  endpointsPath: string
  localized: boolean
  secret?: string
  slug: string
  trackHits: boolean
}

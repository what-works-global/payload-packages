import type {
  CollectionConfig,
  CollectionSlug,
  DataFromCollectionSlug,
  JsonObject,
  PayloadRequest,
  SelectType,
} from 'payload'

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

export interface RedirectsPluginConfig {
  /**
   * Cache the middleware reads redirects from and the plugin writes to on
   * every change. Both sides must be constructed with the same adapter —
   * define it once in a shared module. Adapters live in
   * `@whatworks/payload-redirects/cache`.
   */
  cache: RedirectsCache
  /**
   * Collections editors can pick as internal redirect destinations. Each
   * entry resolves a referenced doc to its path when the cache is built; a
   * published change that moves a doc (or deletes it) re-syncs the cache
   * automatically.
   */
  collections?: RedirectsCollections
  /**
   * Disables endpoints, hooks, and cache syncing while keeping the redirects
   * collection registered so the database schema stays consistent for
   * migrations.
   * @default false
   */
  disabled?: boolean
  /**
   * Base path of the plugin's endpoints under the Payload API route. Must
   * match the middleware's `endpointsPath` option.
   * @default '/payload-redirects' → `/api/payload-redirects/refresh-cache`
   */
  endpointsPath?: string
  /**
   * Track how often (and when last) each redirect was hit: adds read-only
   * `hits`/`lastAccess` sidebar fields and the hit endpoint the middleware
   * reports to.
   * @default true
   */
  hits?: boolean
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
   * When set, the `refresh-cache` and `hit/:id` endpoints require either the
   * `x-payload-redirects-secret` header to equal this value or an
   * authenticated `req.user`; unauthorized requests get a 403. Leave unset for
   * zero-config open endpoints. The middleware sends this as the header.
   */
  secret?: string
  /**
   * Slug of the redirects collection.
   * @default 'redirects'
   */
  slug?: string
}

export type ResolvedRedirectsConfig = {
  cache: RedirectsCache
  collections: Record<string, InternalRedirectsCollectionConfig>
  endpointsPath: string
  hits: boolean
  localized: boolean
  secret?: string
  slug: string
}

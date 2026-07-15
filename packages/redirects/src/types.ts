import type {
  CollectionConfig,
  CollectionSlug,
  DataFromCollectionSlug,
  JsonObject,
  PayloadRequest,
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
    /** Present when the rebuild runs inside a Payload request (hooks, endpoints). */
    req?: PayloadRequest
  }) => null | string | undefined
}

/**
 * Collections editors can pick as internal redirect destinations, keyed by
 * slug. Omit (or pass `{}`) to only offer custom URLs.
 */
export type RedirectsCollections = { [K in CollectionSlug]?: RedirectsCollectionConfig<K> }

/** Loosely-typed view of a collection config used internally. */
export type InternalRedirectsCollectionConfig = {
  path: (args: { doc: JsonObject; req?: PayloadRequest }) => null | string | undefined
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
  /** Final say over the generated collection — receives it fully built, returns what ships. */
  overrides?: (args: { collection: CollectionConfig }) => CollectionConfig
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
  slug: string
}

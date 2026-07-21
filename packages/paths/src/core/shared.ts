/**
 * Primitives shared by BOTH halves of the package — the Payload plugin (path
 * writer) and the framework-agnostic resolver (path reader). Only type-only
 * imports from `payload` are allowed (elided at runtime); nothing here may pull
 * in `payload` runtime, `next*`, or Node built-ins — this module is bundled
 * into the serving entries (`/resolver`, `/cache`, `/next`) and must stay
 * portable.
 */
import type { CollectionSlug } from 'payload'

/**
 * The cache contract both sides speak. `wrap` memoizes a loader under a key,
 * associating the entry with invalidation tags; `invalidate` drops every entry
 * carrying any of the given tags. Adapters live in
 * `@whatworks/payload-paths/cache` (framework-free) and
 * `@whatworks/payload-paths/next` (Next.js `unstable_cache`/`revalidateTag`).
 *
 * The plugin and the resolver do not need to share an adapter *instance* —
 * tags are the contract — but both must talk to the same backing store
 * (automatic with the Next adapter; for `memoryPathsCache` pass the same
 * instance to both sides).
 */
export type PathsCache = {
  /** Drop every cached entry carrying any of these tags. */
  invalidate: (tags: string[]) => Promise<void> | void
  /**
   * Wrap a loader so repeated calls for the same `key` are served from cache.
   * Returns the wrapped loader; `tags` enable targeted invalidation.
   */
  wrap: <T>(
    loader: () => Promise<T>,
    options: { key: string[]; tags: string[] },
  ) => () => Promise<T>
}

/**
 * How a collection's documents map to paths.
 *
 * - `'flat'` — no hierarchy: `path = '/<slug>'`.
 * - `'nested-docs'` — hierarchy via a parent relationship, with the
 *   `@payloadcms/plugin-nested-docs` plugin owning the "re-save children when
 *   a parent changes" cascade. The path is still computed by walking the
 *   parent chain (breadcrumb URLs are never parsed), so the app's
 *   `generateURL` only affects the admin breadcrumb display.
 * - `'parent'` — hierarchy via a parent relationship with NO nested-docs
 *   plugin; this package runs its own child-re-save cascade.
 * - `'auto'` (default) — sniffed from the collection's fields at config build
 *   time: breadcrumbs + parent fields present → `'nested-docs'`; a parent
 *   relationship alone → `'parent'`; neither → `'flat'`.
 */
export type PathsStrategy = 'auto' | 'flat' | 'nested-docs' | 'parent'

export type PathsCollectionOptions = {
  /**
   * Name of the breadcrumbs array field used for `'auto'` strategy detection.
   * @default 'breadcrumbs'
   */
  breadcrumbsField?: string
  /**
   * Suffix appended to the slug when a document is duplicated, so the copy
   * lands on its own path instead of colliding with the original (Payload
   * copies the slug and the published status verbatim). Set `false` to leave
   * slugs untouched on duplicate — copies of published documents then fail
   * with the collision error until the slug is changed.
   * @default '-copy'
   */
  duplicateSlugSuffix?: false | string
  /**
   * Slug of the document that becomes the collection root (`path: '/'`).
   * Applies only to documents with no parent. Set `false` to disable.
   * Inherits the plugin-level `homeSlug` when omitted.
   */
  homeSlug?: false | string
  /**
   * Name of the self-referencing relationship field that forms the hierarchy
   * (used by the `'nested-docs'` and `'parent'` strategies).
   * @default 'parent'
   */
  parentField?: string
  /**
   * URL prefix the collection is served under (`'/blog'`). NOT stored: paths
   * are persisted prefix-free and the prefix is applied at the edges — the
   * resolver strips it from the request URL, and the virtual `url` field
   * composes it back on read. Changing it later is therefore pure config; no
   * stored document data needs rewriting.
   * @default ''
   */
  prefix?: string
  /**
   * Multi-tenant scoping: name of a field (typically a `tenant` relationship)
   * that partitions the path space. Uniqueness is enforced per scope value, so
   * two tenants can both own `/about`. The resolver then requires a `scope`
   * argument to disambiguate.
   */
  scopeField?: string
  /**
   * Name of the slug field paths are built from.
   * @default 'slug'
   */
  slugField?: string
  strategy?: PathsStrategy
  /**
   * Name of the injected virtual field exposing the full URL
   * (`prefix + path`), or `false` to skip injecting it.
   * @default 'url'
   */
  urlField?: false | string
}

export type PathsCollections = Record<string, PathsCollectionOptions | true>

/**
 * Options shared by `pathsPlugin` and `createPathsResolver` /
 * `createPathResolver`. Define once with {@link definePathsConfig} and spread
 * into both sides so prefixes, home slugs, and field names can never drift.
 */
export type SharedPathsConfig = {
  /** Collections that carry paths, keyed by slug. `true` = all defaults. */
  collections: PathsCollections
  /**
   * Default `homeSlug` for all collections (see the per-collection option).
   * @default 'home'
   */
  homeSlug?: false | string
}

/**
 * Identity helper for authoring a {@link SharedPathsConfig} with inference and
 * autocomplete. Returns its argument unchanged; spread the result into both
 * `pathsPlugin` (payload.config.ts) and the resolver (route handlers).
 */
export const definePathsConfig = <T extends SharedPathsConfig>(config: T): T => config

/** Fully-defaulted view of one collection's options, used internally. */
export type ResolvedPathsCollection = {
  breadcrumbsField: string
  /** Who re-saves children when a parent's path changes. */
  cascade: 'internal' | 'nested-docs' | 'none'
  duplicateSlugSuffix: false | string
  homeSlug: false | string
  parentField: string
  prefix: string
  scopeField: null | string
  /** The collection slug, typed for direct use in Local API `collection` args. */
  slug: CollectionSlug
  slugField: string
  strategy: 'flat' | 'nested-docs' | 'parent'
  urlField: false | string
}

export const DEFAULT_HOME_SLUG = 'home'
export const PATH_FIELD_NAME = 'path'

/** `''` stays `''`; anything else becomes `'/segment'` with no trailing slash. */
export const normalizePrefix = (prefix: string): string => {
  const trimmed = prefix.trim().replace(/\/+$/u, '')
  if (trimmed === '' || trimmed === '/') {
    return ''
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** Join URL segments into a leading-slash path: `[] → '/'`, `['a','b'] → '/a/b'`. */
export const segmentsToPath = (segments: string[]): string =>
  `/${segments.filter(Boolean).join('/')}`

/** Inverse of {@link segmentsToPath}: `'/' → []`, `'/a/b' → ['a','b']`. */
export const pathToSegments = (path: string): string[] => path.split('/').filter(Boolean)

/** Append a child slug to a parent path, treating `'/'` as the empty root. */
export const appendSegment = (parentPath: string, slug: string): string =>
  parentPath === '/' ? `/${slug}` : `${parentPath}/${slug}`

/** Compose the public URL from a (normalized) prefix and a stored path. */
export const composeUrl = (prefix: string, path: string): string => {
  if (prefix === '') {
    return path
  }
  return path === '/' ? prefix : `${prefix}${path}`
}

/**
 * Strip a collection prefix from a request pathname, returning the stored-path
 * form — or `null` when the pathname is not under the prefix at all.
 */
export const stripPrefix = (prefix: string, pathname: string): null | string => {
  if (prefix === '') {
    return pathname
  }
  if (pathname === prefix) {
    return '/'
  }
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null
}

/**
 * Normalize a scope value for cache keys and queries: relationship values may
 * arrive populated (`{ id }`) or as a raw id.
 */
export const normalizeScopeValue = (value: unknown): null | string => {
  if (value == null) {
    return null
  }
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') {
      return String(id)
    }
    return null
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return null
}

/** Tag carried by every cached lookup for a collection — bulk invalidation. */
export const collectionTag = (collection: string): string => `payload-paths:${collection}`

/**
 * Tag for one (collection, scope, path) lookup. Both cache hits and cached
 * misses for a path carry it, so creating a document at a previously-404ing
 * path invalidates the cached miss. Tags are built from the STORED
 * (prefix-free) path, so prefix changes never orphan them.
 */
export const pathTag = (collection: string, scope: null | string, path: string): string =>
  `payload-paths:${collection}:${scope ?? ''}:${path}`

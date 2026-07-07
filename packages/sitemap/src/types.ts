import type {
  CollectionSlug,
  DataFromCollectionSlug,
  JsonObject,
  Payload,
  PayloadRequest,
  SelectType,
  Where,
} from 'payload'

import type { SiteUrlContext } from './core/siteUrl.js'

/** A single sitemap URL entry. */
export type SitemapEntry = {
  /** Per-entry change frequency. Ignored by Google; opt-in. */
  changefreq?: ChangeFrequency
  /** W3C datetime string. Google uses this; keep it accurate. */
  lastmod?: string
  /** Absolute URL of the page. */
  loc: string
  /** Per-entry priority (0.0–1.0). Ignored by Google; opt-in. */
  priority?: number
}

export type ChangeFrequency =
  | 'always'
  | 'daily'
  | 'hourly'
  | 'monthly'
  | 'never'
  | 'weekly'
  | 'yearly'

export type SitemapPathArgs<TSlug extends CollectionSlug = CollectionSlug> = {
  doc: DataFromCollectionSlug<TSlug>
  /** Present when generation runs inside a Payload request (REST endpoints). */
  req?: PayloadRequest
}

export type SitemapInvalidateArgs<TSlug extends CollectionSlug = CollectionSlug> = {
  doc: DataFromCollectionSlug<TSlug>
  operation: 'create' | 'update'
  previousDoc?: DataFromCollectionSlug<TSlug>
}

export type SitemapCollectionConfig<TSlug extends CollectionSlug = CollectionSlug> = {
  /** Fixed `<changefreq>` for every entry in this collection. Ignored by Google; opt-in. */
  changeFreq?: ChangeFrequency
  /** Per-collection override of the plugin-level `chunkSize`. */
  chunkSize?: number
  /**
   * Source for `<lastmod>`: a field name, a function of the doc, or `false` to omit.
   * @default 'updatedAt'
   */
  lastMod?:
    | ((doc: DataFromCollectionSlug<TSlug>) => Date | null | string | undefined)
    | false
    | string
  /**
   * Return the document's path (`/about/team`) — it is joined onto `siteUrl`.
   * An absolute `http(s)://` return value is used verbatim (multi-domain escape hatch).
   * Return `null`/`undefined` to omit the document from the sitemap.
   */
  path: (
    args: SitemapPathArgs<TSlug>,
  ) => null | Promise<null | string | undefined> | string | undefined
  /** Fixed `<priority>` for every entry in this collection. Ignored by Google; opt-in. */
  priority?: number
  /**
   * Fields fetched for `path` (and `lastMod` when it is a function).
   * `id`, `updatedAt`, and a string `lastMod` field are always included.
   * @default { slug: true }
   */
  select?: SelectType
  /**
   * Override the default cache-invalidation heuristic for this collection.
   * Default: invalidate on any change except a draft save with no published transition.
   */
  shouldInvalidate?: (args: SitemapInvalidateArgs<TSlug>) => boolean
  /** Extra query constraints AND-ed into the sitemap query. */
  where?: Where
}

/** Loosely-typed view of a collection config used internally. */
export type InternalSitemapCollectionConfig = {
  changeFreq?: ChangeFrequency
  chunkSize?: number
  lastMod?: ((doc: JsonObject) => Date | null | string | undefined) | false | string
  path: (args: {
    doc: JsonObject
    req?: PayloadRequest
  }) => null | Promise<null | string | undefined> | string | undefined
  priority?: number
  select?: SelectType
  shouldInvalidate?: (args: {
    doc: JsonObject
    operation: 'create' | 'update'
    previousDoc?: JsonObject
  }) => boolean
  where?: Where
}

/** A non-collection route to include in the sitemap (static pages, home from a global, …). */
export type SitemapRoute = {
  changeFreq?: ChangeFrequency
  lastMod?: Date | string
  /** Path (`/search`) joined onto `siteUrl`, or an absolute URL used verbatim. */
  path: string
  priority?: number
}

export type SitemapRoutesFn = (args: {
  payload: Payload
  req?: PayloadRequest
}) => Promise<SitemapRoute[]> | SitemapRoute[]

export type SitemapEndpointAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export type SitemapEndpointsConfig = {
  /**
   * Access control for the XML endpoints.
   * @default public — sitemaps exist to be crawled once you opt in
   */
  access?: SitemapEndpointAccess
  /** `Cache-Control` header for endpoint responses. */
  cacheControl?: string
  /**
   * Also expose raw entries at `<path>/entries.json` for SSG frontends.
   * @default false — when `true`, access defaults to authenticated users only
   */
  json?: { access?: SitemapEndpointAccess } | boolean
  /**
   * Public origin used when the index references its chunk files.
   * @default derived from the incoming request URL
   */
  origin?: string
  /**
   * Base path under the Payload API route.
   * @default '/sitemap' → `/api/sitemap/index.xml`, `/api/sitemap/:file`
   */
  path?: string
}

export type ResolvedSitemapEndpoints = {
  access?: SitemapEndpointAccess
  cacheControl: string
  json: { access: SitemapEndpointAccess } | false
  origin?: string
  path: string
}

/**
 * Cache for generated entries, keyed by group (collection slug or the routes group).
 * `wrap` returns cached entries or runs `fn` and stores the result;
 * `invalidate` marks groups dirty so the next request regenerates.
 * Cached `loc` values are site-relative paths (unless `path()` returned an absolute
 * URL) — they are joined onto the resolved `siteUrl` per request, so cached data is
 * never influenced by a request's Host header.
 */
export interface SitemapCache {
  invalidate: (keys: string[]) => Promise<void> | void
  wrap: (key: string, fn: () => Promise<SitemapEntry[]>) => Promise<SitemapEntry[]>
}

export type RobotsRule = {
  allow?: string | string[]
  crawlDelay?: number
  disallow?: string | string[]
  userAgent: string | string[]
}

export type RobotsData = {
  host?: string
  rules: RobotsRule[]
  sitemaps: string[]
}

export type RobotsOptions = {
  /**
   * Allow search engines to index the site. When `false`, the output disallows
   * everything so non-production environments stay out of search indexes.
   * @default VERCEL_ENV === 'production', falling back to NODE_ENV === 'production'
   */
  allowIndexing?: boolean
  /** Extra disallow paths appended to the default rule. Ignored when `rules` is set. */
  disallow?: string[]
  /** Replace the default rules entirely (default: allow all, disallow admin + API routes). */
  rules?: RobotsRule[]
  /** Sitemap URL(s). @default `${siteUrl}/sitemap.xml` */
  sitemaps?: string[]
  /** Final say over the computed output — receives the built data, returns what ships. */
  transform?: (robots: RobotsData) => RobotsData
}

export type SitemapCollections = { [K in CollectionSlug]?: SitemapCollectionConfig<K> }

export interface SitemapPluginConfig {
  /** Control the admin fields injected into configured collections. */
  adminFields?: {
    /** Inject an `excludeFromSitemap` sidebar checkbox. @default true */
    exclude?: boolean
    /**
     * Nest the injected fields inside the group field (or named tab) with this
     * name — e.g. an existing `metadata` group — instead of the collection
     * root. Dot notation reaches nested containers (`'seo.metadata'` = a
     * `metadata` group inside a named `seo` tab or group). Missing segments
     * are created as group fields on each configured collection, so the
     * exclude flag always lives at `<group>.excludeFromSitemap` — changing
     * this on a live project moves the data path (migration required).
     */
    group?: string
  }
  /**
   * Entry cache strategy. `'auto'` uses Next.js tag-based caching when `next/cache`
   * is importable and falls back to an in-memory cache otherwise.
   * @default 'auto'
   */
  cache?: 'auto' | 'memory' | 'none' | SitemapCache
  /** Max URLs per sitemap file (protocol limit is 50,000). @default 25000 */
  chunkSize?: number
  /** Collections to include, keyed by slug. */
  collections: SitemapCollections
  /**
   * Disables generation, hooks, and endpoints while keeping injected fields so the
   * database schema stays consistent for migrations.
   * @default false
   */
  disabled?: boolean
  /**
   * REST endpoints under the Payload API route.
   * @default false — Next.js route handlers (`@whatworks/payload-sitemap/next`) are
   * the primary delivery; enable these for decoupled frontends or proxy setups.
   */
  endpoints?: boolean | SitemapEndpointsConfig
  /** Defaults for `generateRobotsTxt` / `createRobots`. */
  robots?: RobotsOptions
  /** Extra routes to include (static pages, home page from a global, …). */
  routes?: SitemapRoute[] | SitemapRoutesFn
  /**
   * Canonical origin of the site frontend, e.g. `https://example.com`, or a
   * function with full control (it receives the incoming request's headers when
   * one is available).
   * @default SITE_URL → NEXT_PUBLIC_SERVER_URL → https://$VERCEL_PROJECT_PRODUCTION_URL
   * → derived from the incoming request's `x-forwarded-proto`/`x-forwarded-host`/`host`
   * headers. Env vars win over headers so deployments reachable via non-canonical
   * aliases still emit the canonical domain.
   */
  siteUrl?: ((ctx: SiteUrlContext) => string) | string
  /** Append a trailing slash to generated paths. @default false */
  trailingSlash?: boolean
}

export type ResolvedSitemapConfig = {
  cache: SitemapCache
  chunkSize: number
  collections: Record<string, InternalSitemapCollectionConfig>
  endpoints: false | ResolvedSitemapEndpoints
  /**
   * Query path of the exclude checkbox (`excludeFromSitemap`, prefixed with
   * `adminFields.group` when set), or `undefined` when the field is disabled.
   */
  excludeFieldPath?: string
  groups: string[]
  robots: RobotsOptions
  routes?: SitemapRoute[] | SitemapRoutesFn
  /**
   * Resolves the site origin. Static sources (option, env) are memoized;
   * otherwise it derives from the request headers passed in `ctx`.
   */
  siteUrl: (ctx?: SiteUrlContext) => string
  trailingSlash: boolean
}

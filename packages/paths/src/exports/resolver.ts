/**
 * The framework-agnostic resolver: URL segments in, a typed resolution out.
 * No `next` imports, no thrown control flow — `'not-found'` and `'redirect'`
 * come back as values, so any framework (or a plain Node handler) can map
 * them onto its own primitives. `@whatworks/payload-paths/next` wraps this
 * with Next.js sugar (`draftMode()`, `notFound()`, `redirect()`,
 * `unstable_cache`).
 */
import type { CollectionSlug, JsonObject, Payload, SelectType, Where } from 'payload'

import type { PaginationStrategy } from '../core/pagination.js'
import type { PathsCache, SharedPathsConfig } from '../core/shared.js'

import { getSlugSegments, pagePathPagination } from '../core/pagination.js'
import {
  collectionTag,
  composeUrl,
  normalizePrefix,
  pathTag,
  segmentsToPath,
  stripPrefix,
} from '../core/shared.js'
import { noopPathsCache } from './cache.js'

export type {
  PagePathPaginationOptions,
  PaginatedSlugSegments,
  PaginationStrategy,
} from '../core/pagination.js'
export {
  getPathnameWithoutPageNumber,
  getPathnameWithPageNumber,
  getSlugSegments,
  pagePathPagination,
  parsePaginatedSlugSegments,
} from '../core/pagination.js'
export type { PathsCache, SharedPathsConfig } from '../core/shared.js'
export { definePathsConfig, pathToSegments } from '../core/shared.js'

export type PathResolution<TDoc = JsonObject> =
  | {
      /** The collection the document was resolved from — lets a multi-source
       * chain pick the right renderer for the match. */
      collection: string
      doc: TDoc
      /** Page number parsed from a `/page/N` suffix (2+), when present. */
      pageNumber?: number
      /** The stored (prefix-free) path the document was found at. */
      path: string
      type: 'found'
      /** Public URL (prefix included) of the resolved document. */
      url: string
    }
  | {
      /** The collection whose base document triggered the canonical redirect. */
      collection: string
      path: string
      /** Public URL (prefix included) the caller should redirect to. */
      redirectTo: string
      type: 'redirect'
    }
  | {
      path: string
      type: 'not-found'
    }

export type CreatePathsResolverOptions = {
  /**
   * Cache for lookups. Defaults to no caching (always correct). Next.js apps
   * get the `unstable_cache` adapter by default via `createPathResolver` in
   * `@whatworks/payload-paths/next`.
   */
  cache?: PathsCache
  /** The collection to resolve against — must be configured on the plugin. */
  collection: string
  /** The shared paths config — spread the same object into `pathsPlugin`. */
  config: SharedPathsConfig
  /** Depth for the document query. @default 0 */
  depth?: number
  /** Supplies the Payload instance (e.g. `() => getPayload({ config })`). */
  getPayload: () => Promise<Payload>
  /**
   * The pagination scheme applied when an exact-path lookup misses. Defaults to
   * {@link pagePathPagination} (`/…/page/N`, page 1 → canonical redirect). Pass
   * a configured `pagePathPagination({ … })` to rename the segment or drop the
   * page-1 redirect, a custom {@link PaginationStrategy} for a different scheme,
   * or `false` to disable pagination entirely (a `/page/N` URL then only
   * resolves if a real document is stored at that literal path).
   * @default pagePathPagination()
   */
  pagination?: false | PaginationStrategy
  /**
   * Narrow the fields fetched. One resolver instance = one select shape; its
   * value participates in the cache key.
   */
  select?: SelectType
}

export type ResolvePathArgs = {
  /** Bypass the cache and read draft versions (preview mode). */
  draft?: boolean
  /**
   * Resolve an already-built pathname (prefix included) instead of segments.
   */
  pathname?: string
  /** Scope value (e.g. tenant id) for collections with a `scopeField`. */
  scope?: null | string
  /** Route segments, as Next's `[[...slug]]` param provides them. */
  segments?: null | string | string[]
}

export type ListPathsOptions = {
  /** Cap the number of paths returned. Omit to return all published paths. */
  limit?: number
  /**
   * Restrict to one scope (tenant) for a collection with a `scopeField`. Omit
   * on a scoped collection and every scope's paths come back, deduped — pass a
   * scope to prerender one tenant at a time.
   */
  scope?: null | string
  /**
   * Extra filter AND-merged with the built-in constraints (published, non-null
   * `path`, and any `scope`). Use it to NARROW which paths come back — e.g.
   * `{ hideFromPrerender: { not_equals: true } }` or restricting to a section.
   * It can only add constraints, never remove them: drafts and null-path
   * (unroutable) documents are always excluded, so a `where` here can never
   * cause an unpublished or path-less page to be prerendered.
   */
  where?: Where
}

export type PathsResolver<TDoc = JsonObject> = {
  /** All stored paths of the collection (published docs), for static params. */
  listPaths: (options?: ListPathsOptions) => Promise<string[]>
  /**
   * The normalized URL prefix this resolver serves under (`''` for root). Used
   * by {@link createResolverChain} to rank pathname resolution by specificity.
   */
  prefix: string
  resolve: (args: ResolvePathArgs) => Promise<PathResolution<TDoc>>
}

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Build a resolver for one collection. Resolution order: exact path match
 * first (so a real document at `/docs/page/2` beats pagination parsing), then
 * the `/page/N` suffix against the base path — page 1 becomes a redirect to
 * the canonical bare path.
 */
export const createPathsResolver = <TDoc = JsonObject>(
  options: CreatePathsResolverOptions,
): PathsResolver<TDoc> => {
  const { cache = noopPathsCache(), config, depth = 0, getPayload, select } = options
  // `collection` is a plain string in the shared config; cast once to the
  // Local API's `CollectionSlug` so every `find`/`collections[...]` call below
  // typechecks against a consumer's generated types. The assertion is a no-op
  // in this package (CollectionSlug = string) but load-bearing for consumers.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const collection = options.collection as CollectionSlug

  const collectionOptions = config.collections[collection]
  if (collectionOptions === undefined) {
    throw new Error(
      `[payload-paths] Collection "${collection}" is not present in the shared paths config.`,
    )
  }
  const opts = collectionOptions === true ? {} : collectionOptions
  const prefix = normalizePrefix(opts.prefix ?? '')
  const scopeField = opts.scopeField ?? null
  const selectKey = select ? JSON.stringify(select) : ''
  // `false` disables pagination; `undefined` gets the default `/page/N` scheme.
  const pagination: false | PaginationStrategy = options.pagination ?? pagePathPagination()

  const lookup = async (
    path: string,
    scope: null | string,
    draft: boolean,
  ): Promise<null | TDoc> => {
    const payload = await getPayload()
    // With drafts enabled, `draft: false` still returns never-published
    // documents (their main doc carries `_status: 'draft'`) — public lookups
    // must exclude them explicitly.
    const draftsEnabled = Boolean(payload.collections[collection]?.config.versions?.drafts)
    const load = async (): Promise<null | TDoc> => {
      const result = await payload.find({
        collection,
        depth,
        draft,
        limit: 1,
        // A single indexed lookup: never run a count. This is what a
        // draft-aware `getPayload` wrapper would otherwise force globally, so
        // the resolver stays cheap on any plain payload instance (no wrapper
        // required to avoid the extra count query per request).
        pagination: false,
        ...(select ? { select } : {}),
        where: {
          and: [
            { path: { equals: path } },
            ...(scopeField ? [{ [scopeField]: { equals: scope } }] : []),
            ...(!draft && draftsEnabled ? [{ _status: { equals: 'published' } }] : []),
          ],
        },
      })
      return (result.docs[0] as TDoc | undefined) ?? null
    }

    if (draft) {
      return load()
    }

    return cache.wrap(load, {
      key: ['payload-paths', collection, scope ?? '', path, String(depth), selectKey],
      tags: [collectionTag(collection), pathTag(collection, scope, path)],
    })()
  }

  const resolve = async (args: ResolvePathArgs): Promise<PathResolution<TDoc>> => {
    const draft = args.draft ?? false
    const scope = args.scope ?? null

    let requestPath: null | string
    if (args.pathname !== undefined) {
      const pathOnly = args.pathname.split('?')[0] || '/'
      const normalized = pathOnly.length > 1 ? pathOnly.replace(/\/+$/u, '') || '/' : pathOnly
      requestPath = stripPrefix(prefix, normalized)
    } else {
      const segments = getSlugSegments(args.segments).map(decodeSegment)
      requestPath = segmentsToPath(segments)
    }

    if (requestPath === null) {
      return { type: 'not-found', path: args.pathname ?? '/' }
    }

    const exact = await lookup(requestPath, scope, draft)
    if (exact !== null) {
      return {
        type: 'found',
        collection,
        doc: exact,
        path: requestPath,
        url: composeUrl(prefix, requestPath),
      }
    }

    if (pagination === false) {
      return { type: 'not-found', path: requestPath }
    }

    const segments = requestPath.split('/').filter(Boolean)
    const { documentSegments, invalidPage, pageNumber, redirectToDocumentPath } =
      pagination.parse(segments)

    if (invalidPage || (!pageNumber && !redirectToDocumentPath)) {
      return { type: 'not-found', path: requestPath }
    }

    const basePath = segmentsToPath(documentSegments)
    const baseDoc = await lookup(basePath, scope, draft)
    if (baseDoc === null) {
      return { type: 'not-found', path: requestPath }
    }

    if (redirectToDocumentPath) {
      return {
        type: 'redirect',
        collection,
        path: basePath,
        redirectTo: composeUrl(prefix, basePath),
      }
    }

    return {
      type: 'found',
      collection,
      doc: baseDoc,
      pageNumber,
      path: basePath,
      url: composeUrl(prefix, basePath),
    }
  }

  const listPaths = async (listOptions: ListPathsOptions = {}): Promise<string[]> => {
    const limit = listOptions.limit
    if (limit !== undefined && limit <= 0) {
      return []
    }
    const payload = await getPayload()
    const draftsEnabled = Boolean(payload.collections[collection]?.config.versions?.drafts)
    const result = await payload.find({
      collection,
      depth: 0,
      draft: false,
      ...(limit !== undefined ? { limit } : { pagination: false }),
      select: { path: true },
      where: {
        and: [
          { path: { not_equals: null } },
          ...(scopeField && listOptions.scope !== undefined
            ? [{ [scopeField]: { equals: listOptions.scope } }]
            : []),
          ...(draftsEnabled ? [{ _status: { equals: 'published' } }] : []),
          ...(listOptions.where ? [listOptions.where] : []),
        ],
      },
    })
    const paths = result.docs
      .map((doc) => (doc as JsonObject).path)
      .filter((path): path is string => typeof path === 'string')
    // Dedupe: a scoped collection queried without a `scope` returns the same
    // path once per tenant — collapse so callers never emit duplicate params.
    return [...new Set(paths)]
  }

  return { listPaths, prefix, resolve }
}

/**
 * Compose several single-collection resolvers into one — the multi-source /
 * resolver-chain primitive for serving more than one collection from a single
 * route, or resolving an arbitrary pathname across every collection.
 *
 * Resolution order:
 * - **By `segments`** (a catch-all route's param): resolvers are tried in the
 *   order given and the first `found`/`redirect` wins. List the higher-priority
 *   collection first — this is the common "multiple collections at one route"
 *   case, where every collection shares the route's (usually empty) prefix.
 * - **By `pathname`**: only resolvers whose `prefix` the pathname falls under
 *   are tried, most-specific (longest) prefix first — so `/blog/hello` resolves
 *   against the `/blog` collection before a root collection, the way a router
 *   ranks a specific route above a catch-all. Ties keep the given order.
 *
 * The result is itself a `PathsResolver`, so chains compose: `resolve` behaves
 * as above, `listPaths` returns the deduped union of every child's paths (one
 * `generateStaticParams` can then prerender all collections on the route), and
 * `prefix` is the children's shared prefix, or `''` when they differ.
 *
 * Each child keeps its own pagination scheme and cache; the chain only picks a
 * winner. A `/page/N` fallback is evaluated per child in chain order, so an
 * earlier child's pagination match can (in theory) precede a later child's
 * literal `/page/N` document — order the chain accordingly if that matters.
 */
export const createResolverChain = <TDoc = JsonObject>(
  resolvers: PathsResolver<TDoc>[],
): PathsResolver<TDoc> => {
  const prefixes = resolvers.map((resolver) => resolver.prefix)
  const sharedPrefix =
    prefixes.length > 0 && prefixes.every((value) => value === prefixes[0]) ? prefixes[0] : ''

  const resolve = async (args: ResolvePathArgs): Promise<PathResolution<TDoc>> => {
    let candidates = resolvers
    if (args.pathname !== undefined) {
      const pathOnly = args.pathname.split('?')[0] || '/'
      const normalized = pathOnly.length > 1 ? pathOnly.replace(/\/+$/u, '') || '/' : pathOnly
      candidates = resolvers
        .filter((resolver) => stripPrefix(resolver.prefix, normalized) !== null)
        .sort((a, b) => b.prefix.length - a.prefix.length)
    }

    // Falls through to the last child's not-found (correct requestPath); the
    // seed only survives when no candidate applies.
    let miss: PathResolution<TDoc> = { type: 'not-found', path: args.pathname ?? '/' }
    for (const resolver of candidates) {
      const result = await resolver.resolve(args)
      if (result.type !== 'not-found') {
        return result
      }
      miss = result
    }
    return miss
  }

  const listPaths = async (options?: ListPathsOptions): Promise<string[]> => {
    const all = await Promise.all(resolvers.map((resolver) => resolver.listPaths(options)))
    return [...new Set(all.flat())]
  }

  return { listPaths, prefix: sharedPrefix, resolve }
}

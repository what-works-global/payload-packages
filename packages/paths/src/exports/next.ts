/**
 * Next.js sugar over the framework-agnostic core. This is the ONLY entry that
 * imports `next/*` (an optional peer) — importing it is the opt-in. Everything
 * here works on both Next 15 and Next 16: `unstable_cache`, `revalidateTag`,
 * and `revalidatePath` ship in both, and no Cache Components / `'use cache'`
 * compiler features are relied on. When those become the norm, this adapter's
 * internals can migrate without touching the plugin or resolver APIs.
 */
import type { JsonObject, Payload, Where } from 'payload'

import { draftMode } from 'next/headers.js'
import { notFound, redirect } from 'next/navigation.js'
import { cache as reactCache } from 'react'

import type { PaginationStrategy } from '../core/pagination.js'
import type { PathsCache, SharedPathsConfig } from '../core/shared.js'
import type { CreatePathsResolverOptions, PathResolution } from './resolver.js'

import { pathToSegments } from '../core/shared.js'
import { nextPathsCache } from './next-plugin.js'
import { createPathsResolver, createResolverChain } from './resolver.js'

export type { OnPathChanged, PathChangedEvent, PathsPluginConfig } from '../types.js'
// Re-exported for back-compat: the config-side helpers now live in
// `@whatworks/payload-paths/next/plugin` (a `next/navigation`-free entry, so it
// is safe to import into payload.config.ts). Importing them from here still
// works in a Next page runtime, but pulls `next/navigation` in — prefer the
// dedicated `/next/plugin` entry inside a Payload config.
export { nextPathsCache, nextPathsPlugin, revalidatePathsOnChange } from './next-plugin.js'
export { createResolverChain, pagePathPagination } from './resolver.js'
export type { PaginationStrategy, PathResolution, PathsResolver } from './resolver.js'

export type CreatePathResolverOptions = {
  /** Defaults to {@link nextPathsCache}. */
  cache?: PathsCache
  /**
   * The route's dynamic-segment param name — the folder name inside the
   * brackets. `[[...slug]]` → `'slug'` (default), `[[...path]]` → `'path'`,
   * `[[...page]]` → `'page'`. Must match the folder, or `params[paramName]` is
   * `undefined` and every URL resolves to the collection root. Set the SAME
   * value on {@link createGenerateStaticParams} so prerendered params line up.
   * @default 'slug'
   */
  paramName?: string
} & Omit<CreatePathsResolverOptions, 'cache'>

export type ResolvePageArgs = {
  /**
   * The route `params` promise from your page or `generateMetadata`. The
   * catch-all segments are read from the resolver's `paramName` key (default
   * `slug`), so this is typed as an open bag of route params — pass Next's
   * `params` straight through whatever the folder is named.
   */
  params: Promise<Record<string, string | string[] | undefined>>
  /** Scope value (e.g. tenant id) for collections with a `scopeField`. */
  scope?: null | string
}

export type ResolvedPage<TDoc> = {
  /** The collection the document was resolved from (useful with a chain to
   * pick the renderer for the match). */
  collection: string
  doc: TDoc
  /** True when the lookup ran against draft content (preview mode). */
  draft: boolean
  /** Page number from a `/page/N` suffix (2+), when present. */
  pageNumber?: number
  /** The stored (prefix-free) path. */
  path: string
  /** The public URL (prefix included). */
  url: string
}

/**
 * The Next.js page resolver. Draft mode is detected via `draftMode()` (draft
 * lookups bypass the cache), misses call `notFound()`, `/page/1` suffixes
 * `redirect()` to the canonical path, and results are deduped per request with
 * React `cache` so `generateMetadata` and the page share one lookup.
 *
 * ```ts
 * const resolvePage = createPathResolver({ collection: 'pages', config: pathsConfig, getPayload })
 * export default async function Page({ params }: PageProps<'/[[...slug]]'>) {
 *   const { doc, pageNumber } = await resolvePage({ params })
 *   // …
 * }
 * ```
 */
export const createPathResolver = <TDoc = JsonObject>(
  options: CreatePathResolverOptions,
): ((args: ResolvePageArgs) => Promise<ResolvedPage<TDoc>>) => {
  const paramName = options.paramName ?? 'slug'
  const resolver = createPathsResolver<TDoc>({
    ...options,
    cache: options.cache ?? nextPathsCache(),
  })

  const dedupedResolve = reactCache(
    async (
      segmentsKey: string,
      scope: null | string,
      draft: boolean,
    ): Promise<PathResolution<TDoc>> =>
      resolver.resolve({ draft, scope, segments: JSON.parse(segmentsKey) as string[] }),
  )

  return async ({ params, scope = null }: ResolvePageArgs): Promise<ResolvedPage<TDoc>> => {
    const { isEnabled: draft } = await draftMode()
    const raw = (await params)[paramName]
    const segments = Array.isArray(raw) ? raw : raw ? [raw] : []

    const resolution = await dedupedResolve(JSON.stringify(segments), scope, draft)

    if (resolution.type === 'redirect') {
      redirect(resolution.redirectTo)
    }
    if (resolution.type === 'not-found') {
      notFound()
    }

    return {
      collection: resolution.collection,
      doc: resolution.doc,
      draft,
      ...(resolution.pageNumber !== undefined ? { pageNumber: resolution.pageNumber } : {}),
      path: resolution.path,
      url: resolution.url,
    }
  }
}

export type CreateMultiPathResolverOptions = {
  /** Defaults to {@link nextPathsCache}, shared by every collection. */
  cache?: PathsCache
  /**
   * Collections to resolve, in priority order. When more than one is mounted at
   * the same prefix (the usual "many collections at one route" case), the first
   * match in this list wins; see {@link createResolverChain} for the full
   * ordering rules (pathname resolution additionally ranks by prefix
   * specificity).
   */
  collections: string[]
  /** The shared paths config — spread the same object into `pathsPlugin`. */
  config: SharedPathsConfig
  /** Depth for the document query, applied to every collection. @default 0 */
  depth?: number
  /** Supplies the Payload instance (e.g. `() => getPayload({ config })`). */
  getPayload: () => Promise<Payload>
  /**
   * Pagination scheme applied to every collection. @default pagePathPagination()
   * @see {@link CreatePathsResolverOptions.pagination}
   */
  pagination?: false | PaginationStrategy
  /**
   * The route's dynamic-segment param name. @default 'slug'
   * @see {@link CreatePathResolverOptions.paramName}
   */
  paramName?: string
}

/**
 * The Next.js resolver for a route serving MORE THAN ONE collection — e.g. a
 * single `[[...slug]]` that resolves both `pages` and `posts`. Builds one
 * resolver per collection, composes them with {@link createResolverChain}, and
 * wraps the chain in the same Next sugar as {@link createPathResolver}
 * (`draftMode()`, `notFound()`, `redirect()`, per-request React `cache`). The
 * resolved `collection` tells the page which renderer to use.
 *
 * ```ts
 * const resolvePage = createMultiPathResolver({
 *   collections: ['pages', 'posts'], config: pathsConfig, getPayload,
 * })
 * export default async function Page({ params }: PageProps<'/[[...slug]]'>) {
 *   const { collection, doc } = await resolvePage({ params })
 *   return collection === 'posts' ? <Post doc={doc} /> : <Page doc={doc} />
 * }
 * ```
 */
export const createMultiPathResolver = <TDoc = JsonObject>(
  options: CreateMultiPathResolverOptions,
): ((args: ResolvePageArgs) => Promise<ResolvedPage<TDoc>>) => {
  const paramName = options.paramName ?? 'slug'
  const cache = options.cache ?? nextPathsCache()
  const chain = createResolverChain<TDoc>(
    options.collections.map((collection) =>
      createPathsResolver<TDoc>({
        cache,
        collection,
        config: options.config,
        depth: options.depth ?? 0,
        getPayload: options.getPayload,
        ...(options.pagination !== undefined ? { pagination: options.pagination } : {}),
      }),
    ),
  )

  const dedupedResolve = reactCache(
    async (
      segmentsKey: string,
      scope: null | string,
      draft: boolean,
    ): Promise<PathResolution<TDoc>> =>
      chain.resolve({ draft, scope, segments: JSON.parse(segmentsKey) as string[] }),
  )

  return async ({ params, scope = null }: ResolvePageArgs): Promise<ResolvedPage<TDoc>> => {
    const { isEnabled: draft } = await draftMode()
    const raw = (await params)[paramName]
    const segments = Array.isArray(raw) ? raw : raw ? [raw] : []

    const resolution = await dedupedResolve(JSON.stringify(segments), scope, draft)

    if (resolution.type === 'redirect') {
      redirect(resolution.redirectTo)
    }
    if (resolution.type === 'not-found') {
      notFound()
    }

    return {
      collection: resolution.collection,
      doc: resolution.doc,
      draft,
      ...(resolution.pageNumber !== undefined ? { pageNumber: resolution.pageNumber } : {}),
      path: resolution.path,
      url: resolution.url,
    }
  }
}

export type CreateGenerateStaticParamsOptions = {
  /**
   * Max params to prerender; `0` disables prerendering entirely (everything
   * renders on demand), `undefined` prerenders every published path.
   */
  limit?: number
  /**
   * The dynamic-segment param key to emit — the folder name inside the
   * brackets. Must equal the folder AND the resolver's `paramName`, or Next
   * can't match the prerendered params to the route. @default 'slug'
   */
  paramName?: string
  /**
   * - `'optional-catch-all'` — `[[...slug]]`; the collection root (`/`) is
   *   emitted as `{ slug: [] }`.
   * - `'catch-all'` — `[...slug]`; the root path is skipped.
   * - `'dynamic'` — `[slug]`; only single-segment paths are emitted.
   * @default 'optional-catch-all'
   */
  routeType?: 'catch-all' | 'dynamic' | 'optional-catch-all'
  /**
   * For a collection with a `scopeField`, prerender just this scope's paths.
   * Omit and every scope's paths are emitted (deduped) — pass a scope to
   * prerender one tenant at a time (and map it onto your route yourself).
   */
  scope?: null | string
  /**
   * Extra `where` AND-merged with the built-in constraints (published,
   * non-null `path`, scope) to NARROW which paths are prerendered — e.g.
   * `{ hideFromPrerender: { not_equals: true } }`. It can only add constraints:
   * drafts and unroutable (null-path) documents are never prerendered. Paths
   * excluded here still render on demand when the route sets `dynamicParams`.
   */
  where?: Where
} & Omit<CreatePathsResolverOptions, 'cache' | 'depth' | 'pagination' | 'select'>

type RouteType = 'catch-all' | 'dynamic' | 'optional-catch-all'

/** Turn stored (prefix-free) paths into route params for the given route type. */
const emitParams = (
  paths: string[],
  paramName: string,
  routeType: RouteType,
): Record<string, string | string[]>[] => {
  const params: Record<string, string | string[]>[] = []

  for (const path of paths) {
    const segments = pathToSegments(path)
    if (routeType === 'dynamic') {
      if (segments.length === 1) {
        params.push({ [paramName]: segments[0] })
      }
      continue
    }
    if (segments.length === 0 && routeType === 'catch-all') {
      continue
    }
    params.push({ [paramName]: segments })
  }

  return params
}

/**
 * `generateStaticParams` factory driven by the stored paths. Segments never
 * include the collection prefix — the route folder provides it. The emitted
 * objects are keyed by `paramName` (default `slug`), so a `[[...path]]` route
 * gets `{ path: [...] }`. Keys are open (`Record`) because the folder name is
 * config, not a literal.
 */
export const createGenerateStaticParams = (
  options: CreateGenerateStaticParamsOptions,
): (() => Promise<Record<string, string | string[]>[]>) => {
  const {
    limit,
    paramName = 'slug',
    routeType = 'optional-catch-all',
    scope,
    where,
    ...resolverOptions
  } = options
  const resolver = createPathsResolver(resolverOptions)

  return async () => {
    if (limit !== undefined && limit <= 0) {
      return []
    }
    const paths = await resolver.listPaths({
      ...(limit !== undefined ? { limit } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(where !== undefined ? { where } : {}),
    })
    return emitParams(paths, paramName, routeType)
  }
}

export type CreateMultiGenerateStaticParamsOptions = {
  /** Collections whose paths are prerendered on the route (union, deduped). */
  collections: string[]
  /** The shared paths config — spread the same object into `pathsPlugin`. */
  config: SharedPathsConfig
  /** Supplies the Payload instance (e.g. `() => getPayload({ config })`). */
  getPayload: () => Promise<Payload>
  /**
   * Approximate cap across the union — each collection is asked for up to this
   * many, then the deduped union is truncated to it. `0` disables prerendering.
   */
  limit?: number
  /** @default 'slug' @see {@link CreateGenerateStaticParamsOptions.paramName} */
  paramName?: string
  /** @default 'optional-catch-all' */
  routeType?: RouteType
  /** Prerender just this scope's paths across every scoped collection. */
  scope?: null | string
  /** AND-merged narrowing filter, applied to every collection. */
  where?: Where
}

/**
 * `generateStaticParams` for a route serving MORE THAN ONE collection (pair it
 * with {@link createMultiPathResolver}). Prerenders the deduped union of every
 * listed collection's published paths. Where two collections claim the same
 * path, the resolver chain's order decides which one actually renders — the
 * param is only emitted once.
 */
export const createMultiGenerateStaticParams = (
  options: CreateMultiGenerateStaticParamsOptions,
): (() => Promise<Record<string, string | string[]>[]>) => {
  const {
    collections,
    config,
    getPayload,
    limit,
    paramName = 'slug',
    routeType = 'optional-catch-all',
    scope,
    where,
  } = options
  const chain = createResolverChain(
    collections.map((collection) => createPathsResolver({ collection, config, getPayload })),
  )

  return async () => {
    if (limit !== undefined && limit <= 0) {
      return []
    }
    const paths = await chain.listPaths({
      ...(limit !== undefined ? { limit } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(where !== undefined ? { where } : {}),
    })
    const capped = limit !== undefined ? paths.slice(0, limit) : paths
    return emitParams(capped, paramName, routeType)
  }
}

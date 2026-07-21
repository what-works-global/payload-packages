/**
 * @whatworks/payload-paths — core (framework-agnostic) entry.
 *
 * Nothing reachable from here imports `next` or `react`; Next.js apps layer
 * the defaults from `@whatworks/payload-paths/next` on top.
 */
import type { JsonObject } from 'payload'

import { composeUrl } from './core/shared.js'

export { checkPathsAdoption, findPathCollisions } from './core/adoption.js'
export type {
  AdoptionCollectionReport,
  AdoptionReport,
  CheckPathsAdoptionOptions,
  PathCollision,
} from './core/adoption.js'
export { backfillPaths, verifyPathIntegrity } from './core/backfill.js'
export type { BackfillCollectionReport, BackfillReport, IntegrityIssue } from './core/backfill.js'
export { computeDocPath, extractRelationId } from './core/computePath.js'
export {
  getPathnameWithoutPageNumber,
  getPathnameWithPageNumber,
  getSlugSegments,
  pagePathPagination,
  parsePaginatedSlugSegments,
} from './core/pagination.js'
export type {
  PagePathPaginationOptions,
  PaginatedSlugSegments,
  PaginationStrategy,
} from './core/pagination.js'
export { findStaleSlugUniqueIndexes, reconcileSlugIndexes } from './core/reconcileIndexes.js'
export type { StaleUniqueIndex } from './core/reconcileIndexes.js'
export {
  appendSegment,
  collectionTag,
  composeUrl,
  definePathsConfig,
  normalizePrefix,
  pathTag,
  pathToSegments,
  segmentsToPath,
  stripPrefix,
} from './core/shared.js'
export type {
  PathsCache,
  PathsCollectionOptions,
  PathsCollections,
  PathsStrategy,
  ResolvedPathsCollection,
  SharedPathsConfig,
} from './core/shared.js'
export { createParentField, pathsPlugin } from './plugin.js'
export type { BackfillMode, OnPathChanged, PathChangedEvent, PathsPluginConfig } from './types.js'

/**
 * Typed accessor for a document's stored path. Throws when the path is
 * missing — a loud error beats the silently-wrong URLs the old
 * breadcrumb-parsing helpers produced when `breadcrumbs` was not selected.
 */
export const getDocPath = (doc: JsonObject): string => {
  const path = doc.path
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(
      '[payload-paths] Document has no stored path — was `path` selected in the query, and has the document been saved since the paths plugin was installed?',
    )
  }
  return path
}

/** {@link getDocPath} composed with the collection prefix — the public URL. */
export const getDocUrl = (doc: JsonObject, options: { prefix?: string } = {}): string =>
  composeUrl(options.prefix ?? '', getDocPath(doc))

/**
 * A `generateURL` for `@payloadcms/plugin-nested-docs` that mirrors this
 * package's path semantics (home slug at the root, prefix composed in), so the
 * admin's breadcrumb URLs match the real stored paths.
 *
 * ```ts
 * nestedDocsPlugin({ collections: ['pages'], generateURL: createNestedDocsGenerateURL({ homeSlug: 'home' }) })
 * ```
 */
export const createNestedDocsGenerateURL = (
  options: { homeSlug?: false | string; prefix?: string } = {},
): ((docs: JsonObject[]) => string) => {
  const { homeSlug = 'home', prefix = '' } = options
  return (docs) => {
    const segments: string[] = []
    for (const [index, doc] of docs.entries()) {
      const slug = typeof doc.slug === 'string' ? doc.slug : ''
      if (index === 0 && homeSlug !== false && slug === homeSlug) {
        continue
      }
      if (slug) {
        segments.push(slug)
      }
    }
    return composeUrl(prefix, segments.length > 0 ? `/${segments.join('/')}` : '/')
  }
}

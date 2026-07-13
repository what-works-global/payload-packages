import type { AlgoliaIndexSettings, ReindexAccess } from './types.js'

/**
 * Field names skipped by the best-effort text extractor at any depth. The
 * `useAsTitle` field is always excluded on top of this list (it is indexed
 * separately as `title`).
 *
 * - `slug` — derived from the title, not prose
 * - `meta` — the SEO plugin's group; its title/description duplicate the real content
 * - `metadata` — common alternative name for the same thing
 * - `breadcrumbs` — nested-docs labels/urls are indexed separately as `breadcrumbs`
 * - `filename` / `mimeType` / `url` / `thumbnailURL` — upload-collection noise
 * - `apiKey` — auth collections
 */
export const defaultExcludeFields = [
  'slug',
  'meta',
  'metadata',
  'breadcrumbs',
  'filename',
  'mimeType',
  'url',
  'thumbnailURL',
  'apiKey',
]

export const defaultContentLimit = 4000

export const defaultReindexPath = '/algolia-search/reindex'

export const defaultReindexBatchSize = 100

export const defaultReindexAccess: ReindexAccess = ({ req }) => Boolean(req.user)

/**
 * Attribute order doubles as ranking priority: a title match beats a
 * breadcrumb match beats a body match. `filterOnly(collection)` is required
 * for per-collection reindexes (`deleteBy` filter) and is re-added even when
 * `attributesForFaceting` is overridden.
 */
export const defaultIndexSettings: AlgoliaIndexSettings = {
  attributesForFaceting: ['filterOnly(collection)'],
  attributesToHighlight: ['title', 'breadcrumbs'],
  attributesToSnippet: ['content:20'],
  searchableAttributes: ['title', 'breadcrumbs', 'content'],
  snippetEllipsisText: '…',
}

export const pluginKey = '@whatworks/payload-algolia-search'

export const reindexActionPath = `${pluginKey}/rsc#ReindexActionServer`

/**
 * The shape every document is indexed as. One lean, text-only record per
 * document — Algolia matches, ranks, highlights, and snippets server-side, so
 * the record only needs the text worth searching plus what the UI displays.
 *
 * Lives here (dependency-free) because it's shared between the server-side
 * builder and the `/react` frontend entry.
 */
export interface SearchRecord {
  [key: string]: unknown
  /** Ancestor titles + own title (only present when the doc has more than one). */
  breadcrumbs?: string[]
  /** Slug of the collection the document belongs to. Added automatically. */
  collection: string
  /** All indexable text compressed into one attribute, in document order. */
  content?: string
  /** `<collection>:<id>` — assigned automatically, cannot be overridden. */
  objectID: string
  /** Pathname the search UI links to. */
  path?: string
  title?: string
}

/**
 * Records are keyed `<collection>:<id>` so ids may repeat across collections
 * (Postgres serials) without colliding in the shared index.
 */
export const getObjectID = ({
  id,
  collectionSlug,
}: {
  collectionSlug: string
  id: unknown
}): string => `${collectionSlug}:${String(id)}`

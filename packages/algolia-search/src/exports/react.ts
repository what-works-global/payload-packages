'use client'

export {
  Highlight,
  type HighlightedAttributeProps,
  type HighlightPart,
  highlightPostTag,
  highlightPreTag,
  parseHighlightedValue,
  Snippet,
} from '../react/highlight.js'
export type { SearchHit } from '../react/types.js'
export {
  useAlgoliaSearch,
  type UseAlgoliaSearchOptions,
  type UseAlgoliaSearchResult,
} from '../react/useAlgoliaSearch.js'
export {
  useHitCursor,
  type UseHitCursorOptions,
  type UseHitCursorResult,
} from '../react/useHitCursor.js'
export type { SearchRecord } from '../shared.js'

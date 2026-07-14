import type { Hit } from 'algoliasearch/lite'

import type { SearchRecord } from '../shared.js'

/**
 * A `SearchRecord` as returned by a query — decorated with Algolia's
 * `_highlightResult` / `_snippetResult` for the attributes configured in the
 * index settings (`title` and `breadcrumbs` highlighted, `content` snippeted,
 * with the plugin's defaults).
 *
 * `__queryID`/`__position` are stamped on by `useAlgoliaSearch` only when it's
 * called with `clickAnalytics: true`; `useInsights` reads them to tie a click
 * back to the search that surfaced it.
 */
export type SearchHit = {
  /** 1-based rank of this hit within its result page. */
  __position?: number
  /** `queryID` of the search these hits came from. */
  __queryID?: string
} & Hit<SearchRecord>

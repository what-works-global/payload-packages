import type { Hit } from 'algoliasearch/lite'

import type { SearchRecord } from '../shared.js'

/**
 * A `SearchRecord` as returned by a query — decorated with Algolia's
 * `_highlightResult` / `_snippetResult` for the attributes configured in the
 * index settings (`title` and `breadcrumbs` highlighted, `content` snippeted,
 * with the plugin's defaults).
 */
export type SearchHit = Hit<SearchRecord>

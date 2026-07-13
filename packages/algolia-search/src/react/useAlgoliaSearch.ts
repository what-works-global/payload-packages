'use client'

import type { LiteClient } from 'algoliasearch/lite'

import { liteClient } from 'algoliasearch/lite'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { SearchHit } from './types.js'

import { highlightPostTag, highlightPreTag } from './highlight.js'

export interface UseAlgoliaSearchOptions {
  /** Algolia application ID (`NEXT_PUBLIC_…` — this runs in the browser). */
  appId: string
  /** Milliseconds to wait after the last keystroke before searching. Default 100. */
  debounceMs?: number
  /** `false` pauses searching (e.g. while the search modal is closed). Default `true`. */
  enabled?: boolean
  /** Algolia `filters` expression, e.g. `'collection:news'`. */
  filters?: string
  /** Default 20. */
  hitsPerPage?: number
  /** The index the plugin syncs into. */
  indexName: string
  /**
   * A **search-only** API key — never the admin key the plugin is configured
   * with server-side.
   */
  searchApiKey: string
  /**
   * Extra Algolia search parameters merged into every request. Compared by
   * value, so an inline object literal is fine.
   */
  searchParams?: Record<string, unknown>
}

export interface UseAlgoliaSearchResult<THit extends SearchHit = SearchHit> {
  /** Last request failure. Cleared by the next response. */
  error: Error | null
  /** Hits for the latest query — `[]` while the query is empty. */
  hits: THit[]
  /** `true` from the keystroke until the response for the latest query lands. */
  loading: boolean
  query: string
  setQuery: (query: string) => void
}

/**
 * Debounced search-as-you-type against the plugin's index, using Algolia's
 * lite client. Empty queries clear the hits without a request; responses
 * arriving out of order are dropped. Type the extra attributes a `record`
 * transform adds via the generic: `useAlgoliaSearch<SearchHit & { section: string }>`.
 */
export function useAlgoliaSearch<THit extends SearchHit = SearchHit>(
  options: UseAlgoliaSearchOptions,
): UseAlgoliaSearchResult<THit> {
  const {
    appId,
    debounceMs = 100,
    enabled = true,
    filters,
    hitsPerPage = 20,
    indexName,
    searchApiKey,
    searchParams,
  } = options

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<THit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const client = useMemo<LiteClient | null>(
    () => (appId && searchApiKey ? liteClient(appId, searchApiKey) : null),
    [appId, searchApiKey],
  )

  /** Monotonic id so responses for superseded queries are dropped. */
  const requestId = useRef(0)

  // Value-compared so an inline `searchParams: { … }` doesn't re-search (or
  // loop) on every render; parsed back inside the effect.
  const searchParamsKey = searchParams ? JSON.stringify(searchParams) : ''

  useEffect(() => {
    const current = ++requestId.current

    if (!enabled) {
      setLoading(false)
      return undefined
    }

    if (!client || !indexName || !query.trim()) {
      setHits([])
      setLoading(false)
      setError(null)
      return undefined
    }

    setLoading(true)

    const timer = setTimeout(() => {
      client
        .searchForHits<THit>({
          requests: [
            {
              filters,
              highlightPostTag,
              highlightPreTag,
              hitsPerPage,
              indexName,
              query,
              ...(searchParamsKey
                ? (JSON.parse(searchParamsKey) as Record<string, unknown>)
                : undefined),
            },
          ],
        })
        .then(({ results }) => {
          if (requestId.current !== current) {
            return
          }
          setHits(results[0]?.hits ?? [])
          setError(null)
          setLoading(false)
        })
        .catch((caught: unknown) => {
          if (requestId.current !== current) {
            return
          }
          setError(caught instanceof Error ? caught : new Error(String(caught)))
          setLoading(false)
        })
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [client, debounceMs, enabled, filters, hitsPerPage, indexName, query, searchParamsKey])

  return { error, hits, loading, query, setQuery }
}

'use client'

import type { InsightsClient } from 'search-insights'

import { useCallback, useEffect, useRef } from 'react'

import type { SearchHit } from './types.js'

export interface UseInsightsOptions {
  /** Algolia application ID — the same one passed to `useAlgoliaSearch`. */
  appId: string
  /**
   * `false` loads nothing and sends no events — wire it to cookie/analytics
   * consent so `search-insights` is only pulled in and initialised once the
   * visitor opts in. Default `true`.
   */
  enabled?: boolean
  /** The index the events refer to. */
  indexName: string
  /**
   * A **search-only** API key — the same one used for `useAlgoliaSearch`, never
   * the admin key.
   */
  searchApiKey: string
  /**
   * Identify the visitor (e.g. a logged-in user id) so events follow them
   * across devices. Omit to let `search-insights` manage an anonymous,
   * cookie-persisted token.
   */
  userToken?: string
}

export interface UseInsightsResult {
  /**
   * Report a click on a result. When the hit carries `__queryID`/`__position`
   * (i.e. it came from `useAlgoliaSearch({ clickAnalytics: true })`) it's sent
   * as `clickedObjectIDsAfterSearch`, tying the click to its search; otherwise
   * as a plain `clickedObjectIDs`. No-op until `search-insights` has loaded.
   */
  sendClick: (hit: SearchHit, eventName?: string) => void
  /**
   * Report a conversion on a result. Sent as `convertedObjectIDsAfterSearch`
   * when the hit carries a `__queryID`, otherwise as a plain
   * `convertedObjectIDs`.
   */
  sendConversion: (hit: SearchHit, eventName?: string) => void
}

/**
 * Algolia [Insights](https://www.algolia.com/doc/guides/sending-events/getting-started/)
 * click/conversion tracking for search results, built on the official
 * `search-insights` client — which manages the anonymous user token, cookie,
 * and event batching for us.
 *
 * `search-insights` is an **optional peer dependency**, loaded lazily the first
 * time this hook runs so it stays out of bundles that never track: install it
 * only in apps that call `useInsights`. Pair with
 * `useAlgoliaSearch({ clickAnalytics: true })` so hits carry the
 * `__queryID`/`__position` that make clicks attributable to their search.
 */
export function useInsights(options: UseInsightsOptions): UseInsightsResult {
  const { appId, enabled = true, indexName, searchApiKey, userToken } = options

  const clientRef = useRef<InsightsClient | null>(null)

  useEffect(() => {
    if (!enabled || !appId || !searchApiKey) {
      clientRef.current = null
      return
    }

    let cancelled = false
    void import('search-insights')
      .then((mod) => {
        if (cancelled) {
          return
        }
        // `search-insights`' own types nest the callable under a second
        // `default`; normalise across CJS/ESM interop and narrow to the client.
        const loaded = mod as unknown as { default?: InsightsClient } & InsightsClient
        const aa = loaded.default ?? loaded
        aa('init', {
          apiKey: searchApiKey,
          appId,
          ...(userToken ? { userToken } : { useCookie: true }),
        })
        clientRef.current = aa
      })
      .catch(() => {
        // `search-insights` isn't installed, or failed to load — tracking is
        // best-effort and silently disabled.
      })

    return () => {
      cancelled = true
    }
  }, [appId, enabled, searchApiKey, userToken])

  const send = useCallback(
    (kind: 'click' | 'conversion', hit: SearchHit, eventName: string) => {
      const aa = clientRef.current
      if (!enabled || !aa) {
        return
      }

      const objectIDs = [hit.objectID]

      // "After search" events tie the action to the query that surfaced the
      // hit; a click also carries its 1-based position. Without a queryID we
      // fall back to the plain object-level event.
      if (hit.__queryID) {
        if (kind === 'click') {
          if (typeof hit.__position === 'number') {
            void aa('clickedObjectIDsAfterSearch', {
              eventName,
              index: indexName,
              objectIDs,
              positions: [hit.__position],
              queryID: hit.__queryID,
            })
            return
          }
        } else {
          void aa('convertedObjectIDsAfterSearch', {
            eventName,
            index: indexName,
            objectIDs,
            queryID: hit.__queryID,
          })
          return
        }
      }

      void aa(kind === 'click' ? 'clickedObjectIDs' : 'convertedObjectIDs', {
        eventName,
        index: indexName,
        objectIDs,
      })
    },
    [enabled, indexName],
  )

  const sendClick = useCallback(
    (hit: SearchHit, eventName = 'Hit Clicked') => send('click', hit, eventName),
    [send],
  )
  const sendConversion = useCallback(
    (hit: SearchHit, eventName = 'Hit Converted') => send('conversion', hit, eventName),
    [send],
  )

  return { sendClick, sendConversion }
}

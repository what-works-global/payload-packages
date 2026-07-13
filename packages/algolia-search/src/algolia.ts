import { algoliasearch } from 'algoliasearch'

import type { AlgoliaClient, AlgoliaSearchPluginConfig } from './types.js'

/** Lazy singleton — no client is constructed until the first sync/reindex. */
export const createAlgoliaClientFactory = (
  algolia: AlgoliaSearchPluginConfig['algolia'],
): (() => AlgoliaClient) => {
  let client: AlgoliaClient | undefined
  return () => {
    if (!client) {
      const { apiKey, appId, clientOptions } = algolia ?? {}
      if (!appId || !apiKey) {
        throw new Error('[algolia-search] missing Algolia credentials — cannot create a client')
      }
      client = algoliasearch(appId, apiKey, clientOptions)
    }
    return client
  }
}

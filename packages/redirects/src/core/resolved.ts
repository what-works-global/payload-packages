import type { Config, SanitizedConfig } from 'payload'

import type {
  InternalRedirectsCollectionConfig,
  RedirectsPluginConfig,
  ResolvedRedirectsConfig,
} from '../types.js'

import {
  DEFAULT_COLLECTION_SLUG,
  DEFAULT_ENDPOINTS_PATH,
  DEFAULT_LIST_MAX_AGE,
  DEFAULT_LIST_STALE_WHILE_REVALIDATE,
  DEFAULT_REDIRECTS_CACHE_TAG,
} from './shared.js'

export const resolveRedirectsConfig = (
  pluginConfig: RedirectsPluginConfig,
): ResolvedRedirectsConfig => ({
  slug: pluginConfig.slug ?? DEFAULT_COLLECTION_SLUG,
  cache: pluginConfig.cache,
  collections: (pluginConfig.collections ?? {}) as Record<
    string,
    InternalRedirectsCollectionConfig
  >,
  endpointsPath: pluginConfig.endpointsPath ?? DEFAULT_ENDPOINTS_PATH,
  list: {
    disabled: pluginConfig.list?.disabled === true,
    invalidate: pluginConfig.list?.invalidate,
    maxAge: pluginConfig.list?.maxAge ?? DEFAULT_LIST_MAX_AGE,
    path: pluginConfig.list?.path,
    staleWhileRevalidate:
      pluginConfig.list?.staleWhileRevalidate ?? DEFAULT_LIST_STALE_WHILE_REVALIDATE,
    tags: pluginConfig.list?.tags ?? [DEFAULT_REDIRECTS_CACHE_TAG],
  },
  localized: pluginConfig.localized === true,
  secret: pluginConfig.secret,
  trackHits: pluginConfig.trackHits !== false,
})

/**
 * The resolved plugin config, stored on `config.custom` so hooks, endpoints,
 * and companion helpers (`syncRedirectsCache`) share it without re-threading
 * options. Throws when the plugin is not installed (or `disabled`).
 */
export const getRedirectsConfig = (config: Config | SanitizedConfig): ResolvedRedirectsConfig => {
  const resolved = config.custom?.redirects as ResolvedRedirectsConfig | undefined
  if (!resolved) {
    throw new Error(
      '[payload-redirects] Plugin config not found — is redirectsPlugin installed (and not disabled) on this Payload config?',
    )
  }
  return resolved
}

import type { Config, SanitizedConfig } from 'payload'

import type {
  InternalRedirectsCollectionConfig,
  RedirectsPluginConfig,
  ResolvedRedirectsConfig,
} from '../types.js'

import { DEFAULT_COLLECTION_SLUG, DEFAULT_ENDPOINTS_PATH } from './shared.js'

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
  hits: pluginConfig.hits !== false,
  localized: pluginConfig.localized === true,
  secret: pluginConfig.secret,
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

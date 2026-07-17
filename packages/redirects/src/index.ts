export { buildRedirectsCacheEntries, syncRedirectsCache } from './core/build.js'
export {
  validateFromField,
  validateQueryParamKey,
  validateSafeRegexPattern,
  validateScrollTo,
  validateUrlOrPathname,
} from './core/collection.js'
export { defineRedirectsConfig, type SharedRedirectsConfig } from './core/config.js'
export {
  migrateFromOfficialRedirects,
  type MigrateFromOfficialRedirectsResult,
} from './core/migrate.js'
export { getRedirectsConfig } from './core/resolved.js'
export {
  appendTrailingSlash,
  applyQueryParams,
  applyScrollTo,
  type CachedRedirect,
  canonicalizePathname,
  canonicalizeSearch,
  DEFAULT_COLLECTION_SLUG,
  DEFAULT_ENDPOINTS_PATH,
  getNormalizedRequestTargets,
  isCachedRedirect,
  matchRedirect,
  mergeForwardedQuery,
  normalizeQueryParams,
  normalizeRedirectFrom,
  normalizeRedirectPathname,
  normalizeScrollTo,
  type RedirectMatchType,
  type RedirectsCache,
  type RedirectStatus,
  type ResolvedRedirect,
  resolveRedirect,
  type ResolveRedirectOptions,
  type ResolveRedirectSkipEvent,
  type ResolveRedirectSkipReason,
  stripFragment,
} from './core/shared.js'
export { redirectsPlugin } from './plugin.js'
export type {
  RedirectsCollectionConfig,
  RedirectsCollections,
  RedirectsPluginConfig,
  ResolvedRedirectsConfig,
} from './types.js'

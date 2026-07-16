export { buildRedirectsCacheEntries, syncRedirectsCache } from './core/build.js'
export {
  validateFromField,
  validateSafeRegexPattern,
  validateScrollTo,
  validateUrlOrPathname,
} from './core/collection.js'
export {
  migrateFromOfficialRedirects,
  type MigrateFromOfficialRedirectsResult,
} from './core/migrate.js'
export { getRedirectsConfig } from './core/resolved.js'
export {
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
  normalizeRedirectFrom,
  normalizeRedirectPathname,
  normalizeScrollTo,
  type RedirectMatchType,
  type RedirectsCache,
  type RedirectType,
  type ResolvedRedirect,
  resolveRedirect,
  stripFragment,
} from './core/shared.js'
export { redirectsPlugin } from './plugin.js'
export type {
  RedirectsCollectionConfig,
  RedirectsCollections,
  RedirectsPluginConfig,
  ResolvedRedirectsConfig,
} from './types.js'

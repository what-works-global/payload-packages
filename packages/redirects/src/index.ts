export { buildRedirectsCacheEntries, syncRedirectsCache } from './core/build.js'
export { validateFromField, validateScrollTo, validateUrlOrPathname } from './core/collection.js'
export { getRedirectsConfig } from './core/resolved.js'
export {
  applyScrollTo,
  type CachedRedirect,
  DEFAULT_COLLECTION_SLUG,
  DEFAULT_ENDPOINTS_PATH,
  getNormalizedRequestTargets,
  isCachedRedirect,
  matchRedirect,
  normalizeRedirectFrom,
  normalizeRedirectPathname,
  normalizeScrollTo,
  type RedirectsCache,
  type RedirectType,
} from './core/shared.js'
export { redirectsPlugin } from './plugin.js'
export type {
  RedirectsCollectionConfig,
  RedirectsCollections,
  RedirectsPluginConfig,
  ResolvedRedirectsConfig,
} from './types.js'

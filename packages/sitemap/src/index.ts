export {
  createMemoryCache,
  createNextTagsCache,
  noopCache,
  SITEMAP_CACHE_TAG,
  sitemapCacheTag,
} from './core/cache.js'

export { chunkFileName, getChunkEntries, getIndexItems, matchChunkFile } from './core/chunks.js'
export { finalizeEntries, formatLoc, getGroupEntries, getSitemapEntries } from './core/entries.js'
export { invalidateSitemap } from './core/invalidate.js'
export { getSitemapConfig, ROUTES_GROUP } from './core/resolved.js'
export { buildRobotsData, generateRobotsTxt, renderRobotsTxt } from './core/robots.js'
export { resolveSiteUrl, siteUrlFromRequest } from './core/siteUrl.js'
export type { SiteUrlContext } from './core/siteUrl.js'
export { buildSitemapIndexXml, buildUrlsetXml, escapeXml } from './core/xml.js'
export { sitemapPlugin } from './plugin.js'

export type * from './types.js'

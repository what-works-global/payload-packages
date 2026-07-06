import type { SanitizedConfig } from 'payload'

import type {
  InternalSitemapCollectionConfig,
  ResolvedSitemapConfig,
  ResolvedSitemapEndpoints,
  SitemapPluginConfig,
} from '../types.js'

import { resolveCache } from './cache.js'
import { resolveSiteUrl, resolveStaticSiteUrl } from './siteUrl.js'

/** Reserved group name for entries from the `routes` option. */
export const ROUTES_GROUP = '_routes'

export const DEFAULT_CHUNK_SIZE = 25_000

export const DEFAULT_CACHE_CONTROL = 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400'

export const DEFAULT_ENDPOINTS_PATH = '/sitemap'

const resolveEndpoints = (
  option: SitemapPluginConfig['endpoints'],
): false | ResolvedSitemapEndpoints => {
  if (!option) {
    return false
  }
  const config = option === true ? {} : option
  return {
    access: config.access,
    cacheControl: config.cacheControl ?? DEFAULT_CACHE_CONTROL,
    json: config.json
      ? {
          access:
            (config.json === true ? undefined : config.json.access) ??
            (({ req }) => Boolean(req.user)),
        }
      : false,
    origin: config.origin,
    path: config.path ?? DEFAULT_ENDPOINTS_PATH,
  }
}

export const resolveSitemapConfig = (pluginConfig: SitemapPluginConfig): ResolvedSitemapConfig => {
  const collections = pluginConfig.collections as unknown as Record<
    string,
    InternalSitemapCollectionConfig
  >

  if (ROUTES_GROUP in collections) {
    throw new Error(
      `[payload-sitemap] "${ROUTES_GROUP}" is reserved for the \`routes\` option and cannot be used as a collection slug.`,
    )
  }

  let memoizedStaticSiteUrl: string | undefined

  return {
    cache: resolveCache(pluginConfig.cache),
    chunkSize: pluginConfig.chunkSize ?? DEFAULT_CHUNK_SIZE,
    collections,
    endpoints: resolveEndpoints(pluginConfig.endpoints),
    excludeFieldPath:
      pluginConfig.adminFields?.exclude !== false
        ? pluginConfig.adminFields?.group
          ? `${pluginConfig.adminFields.group}.excludeFromSitemap`
          : 'excludeFromSitemap'
        : undefined,
    groups: [...Object.keys(collections), ...(pluginConfig.routes ? [ROUTES_GROUP] : [])],
    robots: pluginConfig.robots ?? {},
    routes: pluginConfig.routes,
    siteUrl: (ctx) => {
      // A configured function gets full control on every call; only the static
      // sources (option string, env vars) are safe to memoize.
      if (typeof pluginConfig.siteUrl === 'function') {
        return resolveSiteUrl(pluginConfig.siteUrl, ctx)
      }
      return (memoizedStaticSiteUrl ??= resolveStaticSiteUrl(pluginConfig.siteUrl)) != null
        ? memoizedStaticSiteUrl
        : resolveSiteUrl(undefined, ctx)
    },
    trailingSlash: pluginConfig.trailingSlash ?? false,
  }
}

/** Reads the resolved plugin config stashed on the Payload config by `sitemapPlugin`. */
export const getSitemapConfig = (config: SanitizedConfig): ResolvedSitemapConfig => {
  const resolved = (config.custom as { sitemap?: ResolvedSitemapConfig } | undefined)?.sitemap
  if (!resolved) {
    throw new Error(
      '[payload-sitemap] Plugin config not found — is sitemapPlugin() installed (and not disabled) on this Payload config?',
    )
  }
  return resolved
}

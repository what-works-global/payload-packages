import type { MetadataRoute } from 'next'
import type { SanitizedConfig } from 'payload'

import { getPayload } from 'payload'

import type { RobotsOptions } from '../types.js'

import { getChunkEntries, getIndexItems } from '../core/chunks.js'
import { finalizeEntries } from '../core/entries.js'
import { DEFAULT_CACHE_CONTROL, getSitemapConfig } from '../core/resolved.js'
import { buildRobotsData } from '../core/robots.js'
import { buildSitemapIndexXml, buildUrlsetXml } from '../core/xml.js'

type PayloadConfigInput = Promise<SanitizedConfig> | SanitizedConfig

type RouteFactoryArgs = {
  /** `Cache-Control` header for the response. */
  cacheControl?: string
  config: PayloadConfigInput
}

const xmlResponse = (xml: string, cacheControl: string): Response =>
  new Response(xml, {
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': 'application/xml; charset=utf-8',
    },
  })

/**
 * Metadata routes receive no request object, so when the site origin isn't
 * statically configured fall back to the request headers via `next/headers`
 * (which makes the route dynamic).
 */
const resolveRobotsSiteUrl = async (
  sitemapConfig: ReturnType<typeof getSitemapConfig>,
): Promise<string> => {
  try {
    return sitemapConfig.siteUrl()
  } catch (staticError) {
    try {
      const { headers } = await import('next/headers')
      return sitemapConfig.siteUrl({ request: { headers: await headers() } })
    } catch {
      throw staticError
    }
  }
}

/**
 * Route handler for the sitemap index.
 *
 * ```ts
 * // app/sitemap.xml/route.ts
 * import config from '@payload-config'
 * import { createSitemapIndexRoute } from '@whatworks/payload-sitemap/next'
 *
 * export const dynamic = 'force-dynamic'
 * export const { GET } = createSitemapIndexRoute({ config })
 * ```
 */
export const createSitemapIndexRoute = ({
  cacheControl = DEFAULT_CACHE_CONTROL,
  chunksPath = '/sitemaps',
  config,
}: {
  /** Public path prefix where the chunk route is mounted. @default '/sitemaps' */
  chunksPath?: string
} & RouteFactoryArgs): { GET: (request: Request) => Promise<Response> } => ({
  GET: async (request) => {
    const payload = await getPayload({ config: await config })
    const sitemapConfig = getSitemapConfig(payload.config)
    const base = `${sitemapConfig.siteUrl({ request })}${chunksPath}`
    const items = await getIndexItems({
      chunkUrl: (file) => `${base}/${file}`,
      config: sitemapConfig,
      payload,
    })
    return xmlResponse(buildSitemapIndexXml(items), cacheControl)
  },
})

/**
 * Route handler for individual sitemap chunk files.
 *
 * ```ts
 * // app/sitemaps/[sitemap]/route.ts
 * import config from '@payload-config'
 * import { createSitemapChunkRoute } from '@whatworks/payload-sitemap/next'
 *
 * export const dynamic = 'force-dynamic'
 * export const { GET } = createSitemapChunkRoute({ config })
 * ```
 */
export const createSitemapChunkRoute = ({
  cacheControl = DEFAULT_CACHE_CONTROL,
  config,
  param = 'sitemap',
}: {
  /** Name of the dynamic segment the route is mounted under. @default 'sitemap' */
  param?: string
} & RouteFactoryArgs): {
  GET: (
    request: Request,
    ctx: { params: Promise<Record<string, string | string[] | undefined>> },
  ) => Promise<Response>
} => ({
  GET: async (request, ctx) => {
    const params = await ctx.params
    const rawFile = params[param]
    const file = Array.isArray(rawFile) ? rawFile[0] : rawFile
    if (!file) {
      return new Response('Not found', { status: 404 })
    }

    const payload = await getPayload({ config: await config })
    const sitemapConfig = getSitemapConfig(payload.config)
    const chunk = await getChunkEntries({ config: sitemapConfig, file, payload })
    if (!chunk) {
      return new Response('Not found', { status: 404 })
    }

    const collConfig = sitemapConfig.collections[chunk.group]
    const entries = finalizeEntries(chunk.entries, {
      siteUrl: sitemapConfig.siteUrl({ request }),
      trailingSlash: sitemapConfig.trailingSlash,
    })
    const xml = buildUrlsetXml(entries, {
      changeFreq: collConfig?.changeFreq,
      priority: collConfig?.priority,
    })
    return xmlResponse(xml, cacheControl)
  },
})

/**
 * Default export for `app/robots.ts`. Plugin-level `robots` options apply first,
 * factory overrides win, and `transform` gets the final say.
 *
 * ```ts
 * // app/robots.ts
 * import config from '@payload-config'
 * import { createRobots } from '@whatworks/payload-sitemap/next'
 *
 * export default createRobots({ config })
 * ```
 */
export const createRobots = ({
  config,
  ...overrides
}: { config: PayloadConfigInput } & RobotsOptions): (() => Promise<MetadataRoute.Robots>) => {
  return async () => {
    const awaited = await config
    const sitemapConfig = getSitemapConfig(awaited)
    const options = { ...sitemapConfig.robots, ...overrides }
    const sitemaps = options.sitemaps ?? [
      `${await resolveRobotsSiteUrl(sitemapConfig)}/sitemap.xml`,
    ]

    const data = buildRobotsData({
      adminRoute: awaited.routes.admin,
      apiRoute: awaited.routes.api,
      options,
      sitemaps,
    })

    return {
      rules: data.rules,
      ...(data.sitemaps.length
        ? { sitemap: data.sitemaps.length === 1 ? data.sitemaps[0] : data.sitemaps }
        : {}),
      ...(data.host ? { host: data.host } : {}),
    }
  }
}

import type { SanitizedConfig } from 'payload'

import type { RobotsData, RobotsOptions, RobotsRule } from '../types.js'
import type { SiteUrlContext } from './siteUrl.js'

import { getSitemapConfig } from './resolved.js'

const toArray = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? [value].flat() : [value]

const safePathname = (url: string): string | undefined => {
  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}

/**
 * Adds `Allow` exceptions for sitemap URLs that fall under a disallowed prefix
 * (e.g. a sitemap served from `/api/...` while `/api/` is disallowed).
 */
const allowSitemaps = (rules: RobotsRule[], sitemaps: string[]): RobotsRule[] =>
  rules.map((rule) => {
    const disallow = toArray(rule.disallow)
    const allow = new Set(toArray(rule.allow))
    for (const sitemap of sitemaps) {
      const pathname = safePathname(sitemap)
      if (pathname && disallow.some((prefix) => prefix !== '/' && pathname.startsWith(prefix))) {
        allow.add(pathname)
      }
    }
    return { ...rule, ...(allow.size ? { allow: [...allow] } : {}) }
  })

export type BuildRobotsArgs = {
  /** Payload admin route, used for the default disallow list. @default '/admin' */
  adminRoute?: string
  /** Payload API route, used for the default disallow list. @default '/api' */
  apiRoute?: string
  options?: RobotsOptions
  /** Absolute sitemap URL(s) advertised in the output. */
  sitemaps: string[]
}

export const buildRobotsData = ({
  adminRoute = '/admin',
  apiRoute = '/api',
  options = {},
  sitemaps,
}: BuildRobotsArgs): RobotsData => {
  const isProduction =
    options.isProduction ??
    (process.env.VERCEL_ENV
      ? process.env.VERCEL_ENV === 'production'
      : process.env.NODE_ENV === 'production')

  let data: RobotsData
  if (!isProduction) {
    data = { rules: [{ disallow: '/', userAgent: '*' }], sitemaps: [] }
  } else {
    const sitemapUrls = options.sitemaps ?? sitemaps
    const rules = options.rules ?? [
      {
        disallow: [`${adminRoute}/`, `${apiRoute}/`, ...(options.disallow ?? [])],
        userAgent: '*',
      },
    ]
    data = { rules: allowSitemaps(rules, sitemapUrls), sitemaps: sitemapUrls }
  }

  return options.transform ? options.transform(data) : data
}

export const renderRobotsTxt = (data: RobotsData): string => {
  const blocks = data.rules.map((rule) => {
    const lines = [
      ...toArray(rule.userAgent).map((agent) => `User-agent: ${agent}`),
      ...toArray(rule.allow).map((path) => `Allow: ${path}`),
      ...toArray(rule.disallow).map((path) => `Disallow: ${path}`),
      ...(rule.crawlDelay !== undefined ? [`Crawl-delay: ${rule.crawlDelay}`] : []),
    ]
    return lines.join('\n')
  })

  const footer = [
    ...(data.host ? [`Host: ${data.host}`] : []),
    ...data.sitemaps.map((url) => `Sitemap: ${url}`),
  ]

  return [...blocks, ...(footer.length ? [footer.join('\n')] : [])].join('\n\n') + '\n'
}

/**
 * robots.txt for any delivery mechanism. Defaults come from the plugin config;
 * `overrides` win field-by-field, and `transform` gets the final say. Pass
 * `request` so the default sitemap URL can derive its origin from the incoming
 * request when `siteUrl` isn't configured statically.
 */
export const generateRobotsTxt = async (
  configInput: Promise<SanitizedConfig> | SanitizedConfig,
  overrides?: { request?: SiteUrlContext['request'] } & RobotsOptions,
): Promise<string> => {
  const config = await configInput
  const sitemapConfig = getSitemapConfig(config)
  const { request, ...overrideOptions } = overrides ?? {}
  const options = { ...sitemapConfig.robots, ...overrideOptions }
  const sitemaps = options.sitemaps ?? [`${sitemapConfig.siteUrl({ request })}/sitemap.xml`]

  return renderRobotsTxt(
    buildRobotsData({
      adminRoute: config.routes.admin,
      apiRoute: config.routes.api,
      options,
      sitemaps,
    }),
  )
}

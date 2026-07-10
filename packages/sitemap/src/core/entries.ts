import type { CollectionSlug, Payload, PayloadRequest, SelectType, Where } from 'payload'

import type {
  InternalSitemapCollectionConfig,
  ResolvedSitemapConfig,
  SitemapEntry,
} from '../types.js'

import { getSitemapConfig, ROUTES_GROUP } from './resolved.js'
import { siteUrlFromConfig } from './siteUrl.js'

const PAGE_SIZE = 1000

export const formatLoc = (path: string, siteUrl: string, trailingSlash: boolean): string => {
  if (/^https?:\/\//.test(path)) {
    return path
  }
  let normalized = path.startsWith('/') ? path : `/${path}`
  if (normalized !== '/') {
    normalized = trailingSlash ? normalized.replace(/\/*$/, '/') : normalized.replace(/\/+$/, '')
  }
  return `${siteUrl}${normalized}`
}

/**
 * Joins cached site-relative entries onto the resolved site origin. Entries are
 * cached with relative `loc` paths so cached data is host-independent — a
 * request-derived siteUrl can never leak into the shared cache.
 */
export const finalizeEntries = (
  entries: SitemapEntry[],
  { siteUrl, trailingSlash }: { siteUrl: string; trailingSlash: boolean },
): SitemapEntry[] =>
  entries.map((entry) => ({ ...entry, loc: formatLoc(entry.loc, siteUrl, trailingSlash) }))

const normalizeLastMod = (value: unknown): string | undefined => {
  if (!value) {
    return undefined
  }
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value)
  } else {
    return undefined
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

type FetchArgs = {
  config: ResolvedSitemapConfig
  payload: Payload
  req?: PayloadRequest
}

const fetchCollectionEntries = async (
  { config, payload, req }: FetchArgs,
  // Group keys come from plugin config, so they are plain strings; existence is
  // checked at runtime below.
  slug: CollectionSlug,
  collConfig: InternalSitemapCollectionConfig,
): Promise<SitemapEntry[]> => {
  const collection: Payload['collections'][CollectionSlug] | undefined = payload.collections[slug]
  if (!collection) {
    payload.logger.warn(`[payload-sitemap] Collection "${slug}" does not exist — skipping.`)
    return []
  }

  // `_status` only exists on the schema when drafts are enabled; querying it on a
  // non-draft collection throws a QueryError.
  const draftsEnabled = Boolean(collection.config.versions?.drafts)

  const conditions: Where[] = []
  if (collConfig.where) {
    conditions.push(collConfig.where)
  }
  if (config.excludeFieldPath) {
    conditions.push({ [config.excludeFieldPath]: { not_equals: true } })
  }
  if (draftsEnabled) {
    conditions.push({ _status: { equals: 'published' } })
  }

  const select: SelectType = { ...(collConfig.select ?? { slug: true }), updatedAt: true }
  if (typeof collConfig.lastMod === 'string') {
    select[collConfig.lastMod] = true
  }

  const entries: SitemapEntry[] = []
  let page = 1

  while (true) {
    const result = await payload.find({
      collection: slug,
      depth: 0,
      limit: PAGE_SIZE,
      overrideAccess: true,
      page,
      pagination: true,
      req,
      select,
      sort: 'createdAt',
      where: conditions.length ? { and: conditions } : undefined,
    })

    for (const doc of result.docs) {
      const path = await collConfig.path({ doc, req })
      if (!path) {
        continue
      }

      let lastmod: string | undefined
      if (collConfig.lastMod !== false) {
        const raw =
          typeof collConfig.lastMod === 'function'
            ? collConfig.lastMod(doc)
            : (doc as unknown as Record<string, unknown>)[
                typeof collConfig.lastMod === 'string' ? collConfig.lastMod : 'updatedAt'
              ]
        lastmod = normalizeLastMod(raw)
      }

      entries.push({
        loc: path,
        ...(lastmod ? { lastmod } : {}),
      })
    }

    if (!result.hasNextPage) {
      break
    }
    page += 1
  }

  return entries
}

const fetchRouteEntries = async ({ config, payload, req }: FetchArgs): Promise<SitemapEntry[]> => {
  const routes =
    typeof config.routes === 'function'
      ? await config.routes({ payload, req })
      : (config.routes ?? [])

  return routes.map((route) => {
    const lastmod = normalizeLastMod(route.lastMod)
    return {
      loc: route.path,
      ...(lastmod ? { lastmod } : {}),
      ...(route.changeFreq ? { changefreq: route.changeFreq } : {}),
      ...(route.priority !== undefined ? { priority: route.priority } : {}),
    }
  })
}

/**
 * Cached entries for one group (a collection slug or `ROUTES_GROUP`).
 * `loc` values are site-relative — pass through `finalizeEntries` before rendering.
 */
export const getGroupEntries = async (
  args: { group: string } & FetchArgs,
): Promise<SitemapEntry[]> => {
  const { config, group } = args
  return config.cache.wrap(group, () => {
    if (group === ROUTES_GROUP) {
      return fetchRouteEntries(args)
    }
    const collConfig = config.collections[group]
    if (!collConfig) {
      return Promise.resolve([])
    }
    // The assertion only matters in consumer projects, where generated types
    // narrow CollectionSlug from string to a union of known slugs.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return fetchCollectionEntries(args, group as CollectionSlug, collConfig)
  })
}

/**
 * All sitemap entries with absolute URLs, keyed by group. Public API for SSG
 * frontends and custom delivery — reads the plugin config from the Payload
 * instance. Pass `req` (or `request` — a Fetch Request, or
 * `{ headers: await headers() }` in an RSC) so the site origin can be derived
 * from the request when it isn't configured statically.
 */
export const getSitemapEntries = async (
  payload: Payload,
  options?: {
    groups?: string[]
    req?: PayloadRequest
    request?: { headers?: Headers; url?: null | string }
  },
): Promise<Record<string, SitemapEntry[]>> => {
  const config = getSitemapConfig(payload.config)
  const groups = options?.groups ?? config.groups
  const siteUrl = siteUrlFromConfig(config.siteUrl, { request: options?.request ?? options?.req })
  const result: Record<string, SitemapEntry[]> = {}
  for (const group of groups) {
    const entries = await getGroupEntries({ config, group, payload, req: options?.req })
    result[group] = finalizeEntries(entries, { siteUrl, trailingSlash: config.trailingSlash })
  }
  return result
}

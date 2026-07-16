import type { CollectionSlug, JsonObject, Payload, PayloadRequest, PopulateType } from 'payload'

import type { ResolvedRedirectsConfig } from '../types.js'
import type { CachedRedirect } from './shared.js'

import { getRedirectsConfig } from './resolved.js'
import {
  applyScrollTo,
  getNormalizedRequestTargets,
  matchRedirect,
  normalizeRedirectFrom,
  stripFragment,
} from './shared.js'

type RedirectDoc = {
  caseInsensitive?: unknown
  enabled?: unknown
  forwardQuery?: unknown
  from?: unknown
  id: number | string
  matchType?: unknown
  to?: {
    reference?: { relationTo?: unknown; value?: unknown } | null
    scrollTo?: unknown
    type?: unknown
    url?: unknown
  } | null
  type?: unknown
} & JsonObject

const NON_EXACT_MATCH_TYPES = new Set(['contains', 'endsWith', 'regex', 'startsWith'])

/**
 * `fallbackLocale`/`locale` options for a localized rebuild. Typed as `never`
 * so the object literal still type-checks against a dev sandbox whose generated
 * payload types have no `localization` (there `fallbackLocale` is `null`). The
 * branch only runs when the plugin is genuinely localized, where `'none'` is
 * the value Payload wants for "no fallback".
 */
export const localizedFindArgs = (
  locale: string | undefined,
): { fallbackLocale?: never; locale?: never } =>
  (locale ? { fallbackLocale: 'none', locale } : {}) as {
    fallbackLocale?: never
    locale?: never
  }

/** The redirect fields the cache needs — everything else is left unfetched. */
const cacheSelect = {
  type: true,
  _order: true,
  caseInsensitive: true,
  enabled: true,
  forwardQuery: true,
  from: true,
  matchType: true,
  to: true,
} as const

const resolveDestination = ({
  config,
  doc,
  locale,
  req,
}: {
  config: ResolvedRedirectsConfig
  doc: RedirectDoc
  locale?: string
  req?: PayloadRequest
}): null | string => {
  const to = doc.to
  if (!to || typeof to !== 'object') {
    return null
  }

  // `type` is only stored when internal destinations are configured; without
  // them the collection has no radio and every redirect is a custom URL.
  if (to.type === 'custom' || to.type == null) {
    return typeof to.url === 'string' && to.url.trim() !== '' ? to.url.trim() : null
  }

  if (to.type !== 'reference') {
    return null
  }

  const relationTo = to.reference?.relationTo
  const value = to.reference?.value
  if (typeof relationTo !== 'string' || !value || typeof value !== 'object') {
    return null
  }

  const target = config.collections[relationTo]
  if (!target) {
    return null
  }

  try {
    return target.path({ doc: value as JsonObject, locale, req }) ?? null
  } catch {
    return null
  }
}

/** Denormalizes a single redirect doc into a cache entry, or `null` to drop it. */
const buildEntry = ({
  config,
  doc,
  locale,
  req,
}: {
  config: ResolvedRedirectsConfig
  doc: RedirectDoc
  locale?: string
  req?: PayloadRequest
}): CachedRedirect | null => {
  if (doc.type !== '301' && doc.type !== '302') {
    return null
  }

  if (typeof doc.from !== 'string' || doc.from.trim() === '') {
    return null
  }

  // `enabled` defaults to true; only an explicit `false` excludes the entry.
  if (doc.enabled === false) {
    return null
  }

  const destination = resolveDestination({ config, doc, locale, req })
  if (!destination) {
    return null
  }

  const rawMatchType = typeof doc.matchType === 'string' ? doc.matchType : 'exact'
  const isExact = !NON_EXACT_MATCH_TYPES.has(rawMatchType)

  let from = doc.from.trim()
  if (isExact) {
    try {
      from = normalizeRedirectFrom(from)
    } catch {
      return null
    }
  }

  const entry: CachedRedirect = {
    id: String(doc.id),
    type: doc.type,
    from,
    to: applyScrollTo(destination, doc.to?.scrollTo),
  }

  if (!isExact) {
    entry.match = rawMatchType as CachedRedirect['match']
  }
  if (doc.caseInsensitive === true) {
    entry.caseInsensitive = true
  }
  if (doc.forwardQuery === true) {
    entry.forwardQuery = true
  }
  if (locale) {
    entry.locale = locale
  }

  return entry
}

/** Splits a relative `path?search` string into the pieces `getNormalizedRequestTargets` wants. */
const splitPathSearch = (value: string): { pathname: string; search: string } => {
  const queryIndex = value.indexOf('?')
  return queryIndex === -1
    ? { pathname: value, search: '' }
    : { pathname: value.slice(0, queryIndex), search: value.slice(queryIndex) }
}

const fragmentOf = (value: string): string => {
  const index = value.indexOf('#')
  return index === -1 ? '' : value.slice(index + 1)
}

/**
 * Collapses redirect chains so visitors take a single hop. For each entry,
 * follows its destination through EXACT entries only (within the same locale),
 * up to 10 hops. A cycle is logged and the entry is left unflattened. The final
 * entry keeps the original's id/type/flags; the destination becomes the last
 * hop's, carrying the earliest fragment seen if the last hop has none.
 */
const flattenChains = (entries: CachedRedirect[], payload: Payload): CachedRedirect[] => {
  const byLocale = new Map<string, CachedRedirect[]>()
  for (const entry of entries) {
    const key = entry.locale ?? ''
    const group = byLocale.get(key)
    if (group) {
      group.push(entry)
    } else {
      byLocale.set(key, [entry])
    }
  }

  return entries.map((entry) => {
    const group = byLocale.get(entry.locale ?? '') ?? []
    const exactEntries = group.filter((candidate) => !candidate.match)

    const fragments = [fragmentOf(entry.to)]
    const visitedIds = new Set<string>([entry.id])
    let currentTo = entry.to

    for (let hop = 0; hop < 10; hop++) {
      // Only relative destinations can be chained; an absolute URL leaves the site.
      if (!currentTo.startsWith('/')) {
        break
      }

      const targets = getNormalizedRequestTargets(splitPathSearch(stripFragment(currentTo)))
      const next = exactEntries.find((candidate) => matchRedirect(candidate, targets) !== null)
      if (!next) {
        break
      }

      if (visitedIds.has(next.id)) {
        payload.logger.warn(
          `[payload-redirects] Redirect chain cycle detected starting at "${entry.from}"; leaving it unflattened.`,
        )
        return entry
      }

      visitedIds.add(next.id)
      currentTo = next.to
      fragments.push(fragmentOf(currentTo))
    }

    if (currentTo === entry.to) {
      return entry
    }

    const earliestFragment = fragments.find((fragment) => fragment) ?? ''
    const finalFragment = fragmentOf(currentTo) || earliestFragment
    const finalBase = stripFragment(currentTo)
    const finalTo = finalFragment ? `${finalBase}#${finalFragment}` : finalBase

    return { ...entry, to: finalTo }
  })
}

const buildPopulate = (config: ResolvedRedirectsConfig): PopulateType | undefined => {
  const populate: Record<string, unknown> = {}
  for (const [slug, target] of Object.entries(config.collections)) {
    if (target.select) {
      populate[slug] = target.select
    }
  }
  return Object.keys(populate).length > 0 ? (populate as PopulateType) : undefined
}

const findRedirectDocs = async ({
  config,
  locale,
  payload,
  populate,
  req,
}: {
  config: ResolvedRedirectsConfig
  locale?: string
  payload: Payload
  populate: PopulateType | undefined
  req?: PayloadRequest
}): Promise<RedirectDoc[]> => {
  const result = await payload.find({
    // The assertion only matters in consumer projects, where generated types
    // narrow CollectionSlug from string to a union of known slugs.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    collection: config.slug as CollectionSlug,
    depth: 1,
    ...localizedFindArgs(locale),
    pagination: false,
    ...(populate ? { populate } : {}),
    req,
    select: cacheSelect,
    sort: '_order',
  })

  return result.docs as RedirectDoc[]
}

const localeCodesOf = (locales: unknown): string[] => {
  if (!Array.isArray(locales)) {
    return []
  }
  return locales
    .map((locale) =>
      typeof locale === 'string'
        ? locale
        : typeof (locale as { code?: unknown })?.code === 'string'
          ? (locale as { code: string }).code
          : undefined,
    )
    .filter((code): code is string => typeof code === 'string')
}

/**
 * Loads every redirect (in admin drag order) and denormalizes it into the
 * shape the middleware consumes. Rows that cannot produce a working redirect
 * — unresolvable references, empty destinations, unparseable `from` values,
 * disabled entries — are dropped rather than cached broken. When `localized`,
 * the cache is built once per configured locale. Chains of exact redirects are
 * flattened so each cache entry is a single hop.
 */
export const buildRedirectsCacheEntries = async ({
  config,
  payload,
  req,
}: {
  config: ResolvedRedirectsConfig
  payload: Payload
  req?: PayloadRequest
}): Promise<CachedRedirect[]> => {
  const populate = buildPopulate(config)
  const localization = (payload.config as { localization?: { locales?: unknown } }).localization
  const localeCodes = config.localized ? localeCodesOf(localization?.locales) : []

  let entries: CachedRedirect[]

  if (config.localized && localeCodes.length > 0) {
    entries = []
    for (const locale of localeCodes) {
      const docs = await findRedirectDocs({ config, locale, payload, populate, req })
      for (const doc of docs) {
        const entry = buildEntry({ config, doc, locale, req })
        if (entry) {
          entries.push(entry)
        }
      }
    }
  } else {
    const docs = await findRedirectDocs({ config, payload, populate, req })
    entries = docs.flatMap((doc) => {
      const entry = buildEntry({ config, doc, req })
      return entry ? [entry] : []
    })
  }

  return flattenChains(entries, payload)
}

/**
 * Rebuilds the redirects cache from the database. The plugin calls this from
 * its hooks and the refresh endpoint; call it yourself after seeding
 * redirects programmatically. Pass `req` when running inside a Payload
 * request so the rebuild sees uncommitted transaction state.
 */
export const syncRedirectsCache = async (payload: Payload, req?: PayloadRequest): Promise<void> => {
  const config = getRedirectsConfig(payload.config)
  const entries = await buildRedirectsCacheEntries({ config, payload, req })
  await config.cache.set(entries)
}

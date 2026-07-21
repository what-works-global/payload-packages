import type { JsonObject, Payload } from 'payload'

import { findStaleSlugUniqueIndexes } from './reconcileIndexes.js'
import { getResolvedPathsConfig } from './resolved.js'
import { composeUrl, normalizeScopeValue } from './shared.js'

const BATCH_SIZE = 100
const DEFAULT_URL_SCAN_LIMIT = 100_000

/** Two or more published documents that resolve to the same (scoped) path. */
export type PathCollision = {
  collection: string
  /** The colliding documents' ids (the resolver would only ever serve one). */
  ids: (number | string)[]
  /** The stored (prefix-free) path they share. */
  path: string
  /** Scope (tenant) the collision is within, or `null` for unscoped. */
  scope: null | string
}

/**
 * Find published documents that share a stored path within the same scope — the
 * collisions the backfill and direct writes leave silently (they bypass the
 * publish-time uniqueness check). The resolver serves only the first of each
 * group, so the rest are effectively unreachable. Read-only and paginated; run
 * from a script, not on every boot.
 */
export const findPathCollisions = async (
  payload: Payload,
  options: { collections?: string[] } = {},
): Promise<PathCollision[]> => {
  const resolvedPlugin = getResolvedPathsConfig(payload.config)
  const slugs = options.collections ?? Object.keys(resolvedPlugin.collections)
  const collisions: PathCollision[] = []

  for (const slug of slugs) {
    const resolved = resolvedPlugin.collections[slug]
    if (!resolved) {
      continue
    }
    const draftsEnabled = Boolean(payload.collections?.[resolved.slug]?.config.versions?.drafts)
    const groups = new Map<string, PathCollision>()

    let pageNumber = 1
    while (true) {
      const page = await payload.find({
        collection: resolved.slug,
        depth: 0,
        draft: false,
        limit: BATCH_SIZE,
        page: pageNumber,
        select: {
          path: true,
          ...(resolved.scopeField ? { [resolved.scopeField]: true } : {}),
        },
        sort: 'createdAt',
        where: {
          and: [
            { path: { not_equals: null } },
            ...(draftsEnabled ? [{ _status: { equals: 'published' } }] : []),
          ],
        },
      })

      for (const doc of page.docs) {
        const record = doc as JsonObject
        const path = typeof record.path === 'string' ? record.path : null
        if (path === null) {
          continue
        }
        const scope = resolved.scopeField ? normalizeScopeValue(record[resolved.scopeField]) : null
        const key = `${scope ?? ''}\0${path}`
        const existing = groups.get(key)
        if (existing) {
          existing.ids.push(doc.id)
        } else {
          groups.set(key, { collection: slug, ids: [doc.id], path, scope })
        }
      }

      if (!page.hasNextPage) {
        break
      }
      pageNumber += 1
    }

    for (const group of groups.values()) {
      if (group.ids.length > 1) {
        collisions.push(group)
      }
    }
  }

  return collisions
}

/** One collection's adoption readiness. */
export type AdoptionCollectionReport = {
  collection: string
  /** Published documents sharing a path (see {@link findPathCollisions}). */
  collisions: PathCollision[]
  /** Documents with no slug — unroutable until a slug is set (paths can't be invented). */
  missingSlug: number
  /** Documents whose `path` is still null — run the backfill (or a normal save). */
  nullPath: number
  /** Legacy unique slug/`{scope,slug}` index names the plugin will drop on boot (Mongo). */
  staleUniqueIndexes: string[]
  /**
   * Documents whose public URL changed under the new path scheme — only present
   * when `legacyUrlFor` is supplied. Each is a redirect you likely want to
   * create (`from` → `to`) so old links keep working.
   */
  urlChanges?: { from: string; id: number | string; to: string }[]
}

export type AdoptionReport = {
  collections: AdoptionCollectionReport[]
  /**
   * True when nothing needs attention (no missing slugs, no null paths, no
   * collisions, no stale indexes). `urlChanges` are advisory and do not affect
   * this flag.
   */
  ok: boolean
}

export type CheckPathsAdoptionOptions = {
  /** Restrict to specific collections. Defaults to all configured ones. */
  collections?: string[]
  /**
   * Return a document's OLD public URL to detect URL changes that need
   * redirects. Called per published document; return `null`/`undefined` to skip
   * one. Omit to skip URL-change detection entirely (the expensive part).
   */
  legacyUrlFor?: (doc: JsonObject, collection: string) => null | string | undefined
  /** Cap documents scanned for URL changes per collection. @default 100000 */
  limit?: number
  /** Log a readable summary. @default true */
  log?: boolean
}

/**
 * Pre-adoption (and post-adoption) readiness check for a collection moving onto
 * `@whatworks/payload-paths`. In one read-only pass it reports, per collection:
 * documents with no slug (unroutable), documents whose `path` is still null
 * (need backfilling), published path collisions, stale unique slug/`{scope,
 * slug}` indexes the plugin will drop on boot (Mongo), and — when a
 * `legacyUrlFor` is supplied — every document whose public URL changes under
 * the path scheme, so you can create redirects before old links break (the
 * backfill writes paths silently and fires no `onPathChanged`).
 *
 * Reads potentially every document, so run it from a script (`payload run`),
 * not on boot.
 */
export const checkPathsAdoption = async (
  payload: Payload,
  options: CheckPathsAdoptionOptions = {},
): Promise<AdoptionReport> => {
  const resolvedPlugin = getResolvedPathsConfig(payload.config)
  const slugs = options.collections ?? Object.keys(resolvedPlugin.collections)
  const shouldLog = options.log ?? true
  const scanLimit = options.limit ?? DEFAULT_URL_SCAN_LIMIT

  const allCollisions = await findPathCollisions(payload, { collections: slugs })
  const reports: AdoptionCollectionReport[] = []

  for (const slug of slugs) {
    const resolved = resolvedPlugin.collections[slug]
    if (!resolved) {
      continue
    }

    const [{ totalDocs: missingSlug }, { totalDocs: nullPath }, stale] = await Promise.all([
      payload.count({
        collection: resolved.slug,
        where: { [resolved.slugField]: { exists: false } },
      }),
      payload.count({ collection: resolved.slug, where: { path: { equals: null } } }),
      findStaleSlugUniqueIndexes(payload, resolved),
    ])

    const report: AdoptionCollectionReport = {
      collection: slug,
      collisions: allCollisions.filter((collision) => collision.collection === slug),
      missingSlug,
      nullPath,
      staleUniqueIndexes: stale.map((index) => index.name),
    }

    if (options.legacyUrlFor) {
      report.urlChanges = await collectUrlChanges(
        payload,
        resolved,
        options.legacyUrlFor,
        scanLimit,
      )
    }

    reports.push(report)
    if (shouldLog) {
      logCollectionReport(payload, report)
    }
  }

  const ok = reports.every(
    (report) =>
      report.missingSlug === 0 &&
      report.nullPath === 0 &&
      report.collisions.length === 0 &&
      report.staleUniqueIndexes.length === 0,
  )
  if (shouldLog) {
    payload.logger.info(
      `[payload-paths] Adoption check ${ok ? 'PASSED — nothing needs attention.' : 'found issues (see the per-collection warnings above).'}`,
    )
  }

  return { collections: reports, ok }
}

const collectUrlChanges = async (
  payload: Payload,
  resolved: ReturnType<typeof getResolvedPathsConfig>['collections'][string],
  legacyUrlFor: NonNullable<CheckPathsAdoptionOptions['legacyUrlFor']>,
  scanLimit: number,
): Promise<{ from: string; id: number | string; to: string }[]> => {
  const draftsEnabled = Boolean(payload.collections?.[resolved.slug]?.config.versions?.drafts)
  const changes: { from: string; id: number | string; to: string }[] = []

  let pageNumber = 1
  let scanned = 0
  while (scanned < scanLimit) {
    const page = await payload.find({
      collection: resolved.slug,
      depth: 0,
      draft: false,
      limit: Math.min(BATCH_SIZE, scanLimit - scanned),
      page: pageNumber,
      sort: 'createdAt',
      where: {
        and: [
          { path: { not_equals: null } },
          ...(draftsEnabled ? [{ _status: { equals: 'published' } }] : []),
        ],
      },
    })

    for (const doc of page.docs) {
      scanned += 1
      const record = doc as JsonObject
      const path = typeof record.path === 'string' ? record.path : null
      if (path === null) {
        continue
      }
      const newUrl = composeUrl(resolved.prefix, path)
      const oldUrl = legacyUrlFor(record, resolved.slug)
      if (typeof oldUrl === 'string' && oldUrl !== newUrl) {
        changes.push({ id: doc.id, from: oldUrl, to: newUrl })
      }
    }

    if (!page.hasNextPage) {
      break
    }
    pageNumber += 1
  }

  return changes
}

const logCollectionReport = (payload: Payload, report: AdoptionCollectionReport): void => {
  const problems: string[] = []
  if (report.missingSlug > 0) {
    problems.push(`${report.missingSlug} without a slug (unroutable — set slugs first)`)
  }
  if (report.nullPath > 0) {
    problems.push(`${report.nullPath} with a null path (run the backfill)`)
  }
  if (report.collisions.length > 0) {
    problems.push(`${report.collisions.length} path collision(s) among published docs`)
  }
  if (report.staleUniqueIndexes.length > 0) {
    problems.push(`stale unique index(es): ${report.staleUniqueIndexes.join(', ')}`)
  }
  if (report.urlChanges && report.urlChanges.length > 0) {
    problems.push(`${report.urlChanges.length} URL change(s) — create redirects`)
  }

  if (problems.length === 0) {
    payload.logger.info(`[payload-paths] "${report.collection}" adoption: OK.`)
    return
  }
  payload.logger.warn(`[payload-paths] "${report.collection}" adoption: ${problems.join('; ')}.`)
  for (const collision of report.collisions) {
    payload.logger.warn(
      `[payload-paths]   collision at ${collision.scope ? `[${collision.scope}] ` : ''}${collision.path}: ids ${collision.ids.join(', ')}`,
    )
  }
}

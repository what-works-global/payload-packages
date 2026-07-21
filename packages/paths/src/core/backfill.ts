import type { JsonObject, Payload } from 'payload'

import type { ResolvedPathsPluginConfig } from '../types.js'
import type { ResolvedPathsCollection } from './shared.js'

import { computeDocPath } from './computePath.js'
import { getResolvedPathsConfig } from './resolved.js'
import { collectionTag } from './shared.js'

export type BackfillCollectionReport = {
  collection: string
  /** Documents that could not be repaired (write failed — see the logs). */
  errored: number
  /** Documents whose path was recomputed and written. */
  fixed: number
  /** Null-path documents found (before fixing). */
  missing: number
  /** Documents that stay unroutable (no slug yet — nothing to compute). */
  unroutable: number
}

export type BackfillReport = {
  collections: BackfillCollectionReport[]
}

const BATCH_SIZE = 100

/**
 * Repair documents whose stored `path` is null — created before the plugin
 * was installed, imported straight into the database, or left behind by a
 * bypassed hook. Writes go through the database adapter (`db.updateOne`), so
 * no hooks fire: no cascades, no revalidation storms, and — critically — no
 * accidental publishes or new draft versions. Version tables are untouched;
 * a document's next regular save keeps them consistent.
 *
 * `mode: 'check'` only counts and logs. A healthy collection costs a single
 * indexed count query, which is what makes this safe to run on every boot.
 */
export const backfillPaths = async (
  payload: Payload,
  options: {
    /** Restrict to specific collections. Defaults to all configured ones. */
    collections?: string[]
    /** Max documents repaired per collection per run. @default 1000 */
    limit?: number
    mode?: 'check' | 'fix'
  } = {},
): Promise<BackfillReport> => {
  const resolvedPlugin = getResolvedPathsConfig(payload.config)
  const mode = options.mode ?? 'fix'
  const limit = options.limit ?? resolvedPlugin.backfillLimit
  const slugs = options.collections ?? Object.keys(resolvedPlugin.collections)

  const reports: BackfillCollectionReport[] = []
  for (const slug of slugs) {
    const resolved = resolvedPlugin.collections[slug]
    if (!resolved) {
      payload.logger.warn(`[payload-paths] backfillPaths: "${slug}" is not a paths collection`)
      continue
    }
    reports.push(await backfillCollection(payload, resolvedPlugin, resolved, mode, limit))
  }

  return { collections: reports }
}

const backfillCollection = async (
  payload: Payload,
  plugin: ResolvedPathsPluginConfig,
  resolved: ResolvedPathsCollection,
  mode: 'check' | 'fix',
  limit: number,
): Promise<BackfillCollectionReport> => {
  const report: BackfillCollectionReport = {
    collection: resolved.slug,
    errored: 0,
    fixed: 0,
    missing: 0,
    unroutable: 0,
  }

  const nullPathWhere = { path: { equals: null } }

  const { totalDocs: missing } = await payload.count({
    collection: resolved.slug,
    where: nullPathWhere,
  })
  report.missing = missing

  if (missing === 0) {
    return report
  }

  if (mode === 'check') {
    payload.logger.warn(
      `[payload-paths] ${missing} "${resolved.slug}" document(s) have no path. Set the plugin's \`backfill\` option to 'fix' or run backfillPaths() to repair them.`,
    )
    return report
  }

  // Fixed documents drop out of the null-path filter, so re-querying the first
  // page converges; documents we cannot fix (no slug) are remembered so a page
  // of pure stragglers ends the loop instead of spinning.
  const processed = new Set<string>()
  while (report.fixed < limit) {
    const page = await payload.find({
      collection: resolved.slug,
      depth: 0,
      draft: false,
      limit: BATCH_SIZE,
      select: {
        [resolved.parentField]: true,
        [resolved.slugField]: true,
        ...(resolved.scopeField ? { [resolved.scopeField]: true } : {}),
        path: true,
      },
      sort: 'createdAt',
      where: nullPathWhere,
    })

    const candidates = page.docs.filter((doc) => !processed.has(String(doc.id)))
    if (candidates.length === 0) {
      break
    }

    for (const doc of candidates) {
      processed.add(String(doc.id))
      if (report.fixed >= limit) {
        break
      }

      let path: null | string = null
      try {
        path = await computeDocPath({ collection: resolved, payload }, doc as JsonObject)
      } catch (error) {
        payload.logger.error(
          error,
          `[payload-paths] Backfill could not compute a path for "${resolved.slug}" ${String(doc.id)}`,
        )
        report.errored += 1
        continue
      }

      if (path === null) {
        report.unroutable += 1
        continue
      }

      try {
        await payload.db.updateOne({
          id: doc.id,
          collection: resolved.slug,
          data: { path },
          returning: false,
        })
        report.fixed += 1
      } catch (error) {
        payload.logger.error(
          error,
          `[payload-paths] Backfill failed to write the path for "${resolved.slug}" ${String(doc.id)}`,
        )
        report.errored += 1
      }
    }
  }

  if (report.fixed > 0) {
    try {
      await plugin.cache.invalidate([collectionTag(resolved.slug)])
    } catch {
      // Cache invalidation is best-effort during boot.
    }
  }

  const remaining = report.missing - report.fixed - report.unroutable
  payload.logger.info(
    `[payload-paths] Backfilled "${resolved.slug}": ${report.fixed} fixed, ${report.unroutable} unroutable (no slug), ${report.errored} errored${remaining > 0 ? `, ~${remaining} remaining (limit ${limit})` : ''}.`,
  )

  return report
}

export type IntegrityIssue = {
  collection: string
  expectedPath: null | string
  id: number | string
  storedPath: null | string
}

/**
 * Recompute every document's path and report mismatches against what is
 * stored — drift from bypassed hooks, direct database edits, or failed
 * cascades. Reads everything, so run it from a script (`payload run`), not on
 * boot. Pass `fix: true` to also write the corrected paths (via the database
 * adapter, like the backfill).
 */
export const verifyPathIntegrity = async (
  payload: Payload,
  options: { collections?: string[]; fix?: boolean } = {},
): Promise<IntegrityIssue[]> => {
  const resolvedPlugin = getResolvedPathsConfig(payload.config)
  const slugs = options.collections ?? Object.keys(resolvedPlugin.collections)
  const issues: IntegrityIssue[] = []

  for (const slug of slugs) {
    const resolved = resolvedPlugin.collections[slug]
    if (!resolved) {
      continue
    }

    let pageNumber = 1
    while (true) {
      const page = await payload.find({
        collection: resolved.slug,
        depth: 0,
        draft: false,
        limit: BATCH_SIZE,
        page: pageNumber,
        select: {
          [resolved.parentField]: true,
          [resolved.slugField]: true,
          ...(resolved.scopeField ? { [resolved.scopeField]: true } : {}),
          path: true,
        },
        sort: 'createdAt',
        where: {},
      })

      for (const doc of page.docs) {
        const storedPath =
          typeof (doc as JsonObject).path === 'string' ? ((doc as JsonObject).path as string) : null
        let expectedPath: null | string = null
        try {
          expectedPath = await computeDocPath({ collection: resolved, payload }, doc as JsonObject)
        } catch {
          expectedPath = null
        }

        if (storedPath !== expectedPath) {
          issues.push({ id: doc.id, collection: slug, expectedPath, storedPath })
          if (options.fix) {
            try {
              await payload.db.updateOne({
                id: doc.id,
                collection: resolved.slug,
                data: { path: expectedPath },
                returning: false,
              })
            } catch (error) {
              payload.logger.error(
                error,
                `[payload-paths] verifyPathIntegrity failed to fix "${slug}" ${String(doc.id)}`,
              )
            }
          }
        }
      }

      if (!page.hasNextPage) {
        break
      }
      pageNumber += 1
    }

    if (options.fix && issues.some((issue) => issue.collection === slug)) {
      try {
        await resolvedPlugin.cache.invalidate([collectionTag(slug)])
      } catch {
        // Best-effort.
      }
    }
  }

  return issues
}

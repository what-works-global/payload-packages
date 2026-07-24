import type { JsonObject, Payload, Where } from 'payload'

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
  /**
   * Version snapshots whose `path` was repaired (drafts-enabled collections
   * only). The main-row write bypasses `_<collection>_versions`, so published
   * and draft reads keep serving a pathless snapshot until this runs.
   */
  versionsFixed: number
}

export type BackfillReport = {
  collections: BackfillCollectionReport[]
}

const BATCH_SIZE = 100

/** Main rows (or version snapshots) whose stored path is null/absent. */
const nullPathWhere = { path: { equals: null } }
/**
 * Version snapshots that live reads consume but that carry no path: the latest
 * version of a document (what `draft: true` / the admin list read). Indexed on
 * `latest`, so this stays a cheap gate.
 */
const pathlessLatestVersionWhere: Where = {
  and: [{ latest: { equals: true } }, { 'version.path': { equals: null } }],
}

/** Does this collection persist drafts? Only then do published reads and the admin list come from version snapshots (which the main-row write never touches). */
const collectionHasDrafts = (payload: Payload, slug: string): boolean =>
  Boolean(payload.collections[slug]?.config.versions?.drafts)

/**
 * Bounded fan-out for the backfill's database work — the read-only gate counts
 * and the repair writes alike. The database connection pool is the real limiter
 * (e.g. Mongo's `maxPoolSize`), so this only caps how many promises we park as
 * waiters; it is safe on a pool as small as 3. The gate counts fan out because
 * a healthy install's *only* cost is those counts and they recur on every
 * serverless cold start (`N × RTT` on the request path if run serially). The
 * repair writes fan out because they target distinct documents, so running
 * them concurrently overlaps the round-trips without ever conflicting.
 */
const MAX_CONCURRENCY = 8

/**
 * Run `fn` over `items` with at most `concurrency` promises in flight,
 * preserving input order in the returned array.
 */
const mapPool = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/** The null-path counts that decide whether a collection needs any repair. */
type CollectionGate = {
  hasDrafts: boolean
  missing: number
  versionsMissing: number
}

/**
 * Count the null-path main rows and — for drafts collections — the pathless
 * latest version snapshots. Both predicates are index-backed (`path` and
 * `version.path` are indexed), so this stays cheap. `db.count` (not the Local
 * API `payload.count`) skips access control and the afterRead hooks — including
 * the virtual `url` computation — that a boot task has no use for.
 */
const countCollectionGate = async (
  payload: Payload,
  resolved: ResolvedPathsCollection,
): Promise<CollectionGate> => {
  const hasDrafts = collectionHasDrafts(payload, resolved.slug)
  const { totalDocs: missing } = await payload.db.count({
    collection: resolved.slug,
    where: nullPathWhere,
  })
  const versionsMissing = hasDrafts
    ? (
        await payload.db.countVersions({
          collection: resolved.slug,
          where: pathlessLatestVersionWhere,
        })
      ).totalDocs
    : 0
  return { hasDrafts, missing, versionsMissing }
}

/**
 * Repair documents whose stored `path` is null — created before the plugin
 * was installed, imported straight into the database, or left behind by a
 * bypassed hook. Writes go through the database adapter (`db.updateOne` /
 * `db.updateVersion`), so no hooks fire: no cascades, no revalidation storms,
 * and — critically — no accidental publishes or new draft versions.
 *
 * For drafts-enabled collections the main-row write is not enough: the admin
 * list and every `draft: true` read come from the `_<collection>_versions`
 * snapshot, so the backfill also repairs the *latest* and *latest published*
 * snapshot of each document. Historical snapshots are never routed and are
 * left untouched.
 *
 * `mode: 'check'` only counts and logs. A healthy collection costs one indexed
 * count on the main rows plus one on the version index — which is what makes
 * this safe to run on every boot. Those gate counts run concurrently across
 * collections (bounded, and ultimately capped by the connection pool).
 */
export const backfillPaths = async (
  payload: Payload,
  options: {
    /** Restrict to specific collections. Defaults to all configured ones. */
    collections?: string[]
    mode?: 'check' | 'fix'
  } = {},
): Promise<BackfillReport> => {
  const resolvedPlugin = getResolvedPathsConfig(payload.config)
  const mode = options.mode ?? 'fix'
  const slugs = options.collections ?? Object.keys(resolvedPlugin.collections)

  const targets: ResolvedPathsCollection[] = []
  for (const slug of slugs) {
    const resolved = resolvedPlugin.collections[slug]
    if (!resolved) {
      payload.logger.warn(`[payload-paths] backfillPaths: "${slug}" is not a paths collection`)
      continue
    }
    targets.push(resolved)
  }

  // Read-only gate, fanned out across collections. The fix work below runs one
  // collection at a time (its writes fan out internally) so a dirty sweep never
  // floods a small connection pool with every collection at once.
  const gates = await mapPool(targets, MAX_CONCURRENCY, (resolved) =>
    countCollectionGate(payload, resolved),
  )

  const reports: BackfillCollectionReport[] = []
  for (let index = 0; index < targets.length; index += 1) {
    reports.push(await finishCollection(payload, targets[index], gates[index], mode))
  }

  return { collections: reports }
}

const finishCollection = async (
  payload: Payload,
  resolved: ResolvedPathsCollection,
  gate: CollectionGate,
  mode: 'check' | 'fix',
): Promise<BackfillCollectionReport> => {
  const report: BackfillCollectionReport = {
    collection: resolved.slug,
    errored: 0,
    fixed: 0,
    missing: gate.missing,
    unroutable: 0,
    versionsFixed: 0,
  }

  if (mode === 'check') {
    if (gate.missing > 0) {
      payload.logger.warn(
        `[payload-paths] ${gate.missing} "${resolved.slug}" document(s) have no path. Set the plugin's \`backfill\` option to 'fix' or run backfillPaths() to repair them.`,
      )
    }
    if (gate.versionsMissing > 0) {
      payload.logger.warn(
        `[payload-paths] ${gate.versionsMissing} "${resolved.slug}" version snapshot(s) have no path — the admin list and draft reads use these. Set \`backfill\` to 'fix' or run backfillPaths().`,
      )
    }
    return report
  }

  if (gate.missing > 0) {
    await fixMainRows(payload, resolved, report)
  }

  // Version snapshots are repaired independently of the main-row count: a prior
  // main-only backfill (or an older plugin release) can leave snapshots stale
  // even when every main row already has a path.
  if (gate.versionsMissing > 0) {
    report.versionsFixed = await fixVersionSnapshots(payload, resolved)
  }

  if (report.fixed > 0 || report.versionsFixed > 0) {
    payload.logger.info(
      `[payload-paths] Backfilled "${resolved.slug}": ${report.fixed} fixed, ${report.versionsFixed} version snapshot(s) fixed, ${report.unroutable} unroutable (no slug), ${report.errored} errored.`,
    )
  }

  return report
}

/** Recompute + write `path` on main rows whose stored path is null. */
const fixMainRows = async (
  payload: Payload,
  resolved: ResolvedPathsCollection,
  report: BackfillCollectionReport,
): Promise<void> => {
  // Fixed rows drop out of the null-path filter, so re-querying the first page
  // converges. Only rows we *cannot* fix (no slug, or a write error) are
  // remembered — they stay in the filter, so a page made entirely of them ends
  // the loop instead of spinning.
  const stuck = new Set<string>()

  while (true) {
    const page = await payload.db.find({
      collection: resolved.slug,
      limit: BATCH_SIZE,
      pagination: false,
      select: {
        [resolved.parentField]: true,
        [resolved.slugField]: true,
        ...(resolved.scopeField ? { [resolved.scopeField]: true } : {}),
        path: true,
      },
      sort: 'createdAt',
      where: nullPathWhere,
    })

    const candidates = page.docs.filter((doc) => !stuck.has(String(doc.id)))
    if (candidates.length === 0) {
      break
    }

    await mapPool(candidates, MAX_CONCURRENCY, async (doc) => {
      let path: null | string = null
      try {
        path = await computeDocPath({ collection: resolved, payload }, doc as JsonObject)
      } catch (error) {
        payload.logger.error(
          error,
          `[payload-paths] Backfill could not compute a path for "${resolved.slug}" ${String(doc.id)}`,
        )
        stuck.add(String(doc.id))
        report.errored += 1
        return
      }

      if (path === null) {
        stuck.add(String(doc.id))
        report.unroutable += 1
        return
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
        stuck.add(String(doc.id))
        report.errored += 1
      }
    })
  }
}

/**
 * Repair the `path` on the version snapshots that live reads consume: the
 * latest version of each document and, when that latest is a draft, the latest
 * published version too. Each snapshot's path is recomputed from its OWN slug
 * and the current parent chain (so a snapshot that predates a rename keeps its
 * own URL). Returns the number of snapshots written.
 */
const fixVersionSnapshots = async (
  payload: Payload,
  resolved: ResolvedPathsCollection,
): Promise<number> => {
  let fixed = 0
  const stuck = new Set<string>()

  // Returns whether it actually wrote a path — the caller uses that (not the
  // shared counter, which concurrent tasks also move) to decide if a latest
  // snapshot is stuck.
  const repair = async (v: {
    id: number | string
    parent?: number | string
    version?: JsonObject
  }): Promise<boolean> => {
    const version: JsonObject = v.version ?? {}
    if (typeof version.path === 'string') {
      return false
    }

    let path: null | string = null
    try {
      // `id` is the main document's id (the version's `parent`) so parent-chain
      // cycle detection matches the main-row computation.
      path = await computeDocPath({ collection: resolved, payload }, { ...version, id: v.parent })
    } catch (error) {
      payload.logger.error(
        error,
        `[payload-paths] Backfill could not compute a version path for "${resolved.slug}" (version ${String(v.id)})`,
      )
      return false
    }
    if (path === null) {
      return false
    }

    try {
      await payload.db.updateVersion({
        id: v.id,
        collection: resolved.slug,
        returning: false,
        versionData: { version: { ...version, path } },
      })
      fixed += 1
      return true
    } catch (error) {
      payload.logger.error(
        error,
        `[payload-paths] Backfill failed to write a version path for "${resolved.slug}" (version ${String(v.id)})`,
      )
      return false
    }
  }

  // Driven off the latest snapshots that lack a path (the realistic import
  // shape: a single published+latest snapshot with no path). Repaired snapshots
  // leave the filter; only genuinely unfixable ones go in `stuck`, so a page
  // made entirely of them ends the loop instead of spinning.
  while (true) {
    const page = await payload.db.findVersions({
      collection: resolved.slug,
      limit: BATCH_SIZE,
      sort: 'createdAt',
      where: pathlessLatestVersionWhere,
    })

    const candidates = page.docs.filter((v) => !stuck.has(String(v.id)))
    if (candidates.length === 0) {
      break
    }

    await mapPool(candidates, MAX_CONCURRENCY, async (v) => {
      const wrote = await repair(v)
      if (!wrote) {
        stuck.add(String(v.id))
      }

      // When the latest snapshot is a draft, the live published URL comes from
      // a different (older) snapshot — repair that one too.
      if ((v.version ?? {})._status !== 'published') {
        const publishedWhere: Where = {
          and: [{ parent: { equals: v.parent } }, { 'version._status': { equals: 'published' } }],
        }
        const published = await payload.db.findVersions({
          collection: resolved.slug,
          limit: 1,
          sort: '-updatedAt',
          where: publishedWhere,
        })
        if (published.docs[0]) {
          await repair(published.docs[0])
        }
      }
    })
  }

  return fixed
}

export type IntegrityIssue = {
  collection: string
  expectedPath: null | string
  id: number | string
  storedPath: null | string
  /** True when the mismatch is on a version snapshot rather than the main row. */
  version?: boolean
}

/**
 * Recompute every document's path and report mismatches against what is
 * stored — drift from bypassed hooks, direct database edits, or failed
 * cascades. Also checks the latest version snapshot of drafts-enabled
 * collections (which live reads consume). Reads everything, so run it from a
 * script (`payload run`), not on boot. Pass `fix: true` to also write the
 * corrected paths (via the database adapter, like the backfill).
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
      const page = await payload.db.find({
        collection: resolved.slug,
        limit: BATCH_SIZE,
        page: pageNumber,
        pagination: true,
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

    // Latest version snapshots (what `draft: true` / the admin list read).
    if (collectionHasDrafts(payload, resolved.slug)) {
      let versionPage = 1
      while (true) {
        const page = await payload.db.findVersions({
          collection: resolved.slug,
          limit: BATCH_SIZE,
          page: versionPage,
          pagination: true,
          sort: 'createdAt',
          where: { latest: { equals: true } },
        })

        for (const v of page.docs) {
          const version: JsonObject = v.version ?? {}
          const storedPath = typeof version.path === 'string' ? version.path : null
          let expectedPath: null | string = null
          try {
            expectedPath = await computeDocPath(
              { collection: resolved, payload },
              { ...version, id: v.parent },
            )
          } catch {
            expectedPath = null
          }

          if (storedPath !== expectedPath) {
            issues.push({ id: v.id, collection: slug, expectedPath, storedPath, version: true })
            if (options.fix) {
              try {
                await payload.db.updateVersion({
                  id: v.id,
                  collection: resolved.slug,
                  returning: false,
                  versionData: { version: { ...version, path: expectedPath } },
                })
              } catch (error) {
                payload.logger.error(
                  error,
                  `[payload-paths] verifyPathIntegrity failed to fix "${slug}" version ${String(v.id)}`,
                )
              }
            }
          }
        }

        if (!page.hasNextPage) {
          break
        }
        versionPage += 1
      }
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

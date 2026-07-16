import type { CollectionSlug, JsonObject, Payload, PayloadRequest } from 'payload'

import { getRedirectsConfig } from './resolved.js'
import { normalizeRedirectFrom } from './shared.js'

export type MigrateFromOfficialRedirectsResult = {
  /** Docs that threw during re-save — reported, never thrown. */
  errors: { id: number | string; message: string }[]
  /** Docs that already carried all of this plugin's fields. */
  skipped: number
  /** Docs that were re-saved with backfilled fields. */
  updated: number
}

type OfficialRedirectDoc = {
  enabled?: unknown
  from?: unknown
  id: number | string
  matchType?: unknown
  status?: unknown
} & JsonObject

const VALID_STATUSES = new Set(['301', '302'])
const VALID_MATCH_TYPES = new Set(['contains', 'endsWith', 'exact', 'regex', 'startsWith'])

/**
 * True when an exact-match `from` is not yet canonical, so a re-save is needed
 * to normalize it. Depending on how columns were added when the collection was
 * migrated, `type`/`matchType`/`enabled` may already carry schema defaults — a
 * stale `from` (or a doc never written by this plugin) is the reliable signal
 * that the row still needs to flow through our hooks and into the cache.
 */
const fromNeedsNormalization = (from: unknown, effectiveMatchType: string): boolean => {
  if (effectiveMatchType !== 'exact' || typeof from !== 'string') {
    return false
  }
  try {
    return normalizeRedirectFrom(from) !== from
  } catch {
    return false
  }
}

/**
 * Backfills documents created by the official `@payloadcms/plugin-redirects`
 * with the fields this plugin adds: `status` (defaults to `'301'`), `matchType`
 * (`'exact'`), and `enabled` (`true`). Swap the official plugin for this one on
 * the SAME collection slug, then run this once — the two shapes are otherwise
 * identical (`from` text; `to.type` custom|reference, `to.reference`, `to.url`).
 *
 * Each incomplete doc is re-saved through `payload.update`, so the `from`
 * normalization hook runs and the cache is rebuilt to include it. Docs that
 * already carry all of this plugin's fields are skipped. Per-doc failures are
 * collected and returned, never thrown, so one bad row can't abort the run.
 */
export const migrateFromOfficialRedirects = async ({
  payload,
  req,
}: {
  payload: Payload
  req?: PayloadRequest
}): Promise<MigrateFromOfficialRedirectsResult> => {
  const config = getRedirectsConfig(payload.config)

  const result = await payload.find({
    // The assertion only matters in consumer projects, where generated types
    // narrow CollectionSlug from string to a union of known slugs.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    collection: config.slug as CollectionSlug,
    depth: 0,
    pagination: false,
    req,
  })

  const output: MigrateFromOfficialRedirectsResult = { errors: [], skipped: 0, updated: 0 }

  for (const doc of result.docs as OfficialRedirectDoc[]) {
    const needsStatus = typeof doc.status !== 'string' || !VALID_STATUSES.has(doc.status)
    const needsMatchType =
      typeof doc.matchType !== 'string' || !VALID_MATCH_TYPES.has(doc.matchType)
    const needsEnabled = typeof doc.enabled !== 'boolean'
    const effectiveMatchType = needsMatchType ? 'exact' : (doc.matchType as string)
    const needsNormalization = fromNeedsNormalization(doc.from, effectiveMatchType)

    if (!needsStatus && !needsMatchType && !needsEnabled && !needsNormalization) {
      output.skipped++
      continue
    }

    const data: Record<string, unknown> = {}
    if (needsStatus) {
      data.status = '301'
    }
    if (needsMatchType) {
      data.matchType = 'exact'
    }
    if (needsEnabled) {
      data.enabled = true
    }

    try {
      await payload.update({
        id: doc.id,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        collection: config.slug as CollectionSlug,
        data,
        req,
      })
      output.updated++
    } catch (error) {
      output.errors.push({
        id: doc.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return output
}

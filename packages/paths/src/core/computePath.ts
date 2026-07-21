import type { JsonObject, Payload, PayloadRequest } from 'payload'

import type { ResolvedPathsCollection } from './shared.js'

import { appendSegment } from './shared.js'

/** Depth cap for parent-chain walks — well past any sane page tree. */
const MAX_PARENT_DEPTH = 32

/** Extract the id from a relationship value (raw id or populated doc). */
export const extractRelationId = (value: unknown): null | number | string => {
  if (value == null) {
    return null
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') {
      return id
    }
  }
  return null
}

export type ComputePathContext = {
  collection: ResolvedPathsCollection
  payload: Payload
  /** Passed through to reads so they join any surrounding transaction. */
  req?: PayloadRequest
}

/**
 * Compute a document's stored (prefix-free) path from merged document data.
 *
 * The path is derived from the slug and the parent chain — never from
 * breadcrumb URL strings, so it works identically with and without the
 * nested-docs plugin and is immune to app-specific `generateURL` behavior.
 * A parent's freshly-stored `path` is trusted when present (one cheap indexed
 * read); only parents that are themselves pathless are computed recursively,
 * with cycle and depth guards.
 *
 * Returns `null` when the document is unroutable (no slug yet — e.g. a brand
 * new autosave draft — or a parent chain that cannot resolve).
 */
export const computeDocPath = async (
  ctx: ComputePathContext,
  doc: JsonObject,
  visited: Set<string> = new Set(),
): Promise<null | string> => {
  const { collection } = ctx
  const slug = doc[collection.slugField]

  if (typeof slug !== 'string' || slug === '') {
    return null
  }

  const parentId =
    collection.strategy === 'flat' ? null : extractRelationId(doc[collection.parentField])

  if (parentId == null) {
    if (collection.homeSlug !== false && slug === collection.homeSlug) {
      return '/'
    }
    return `/${slug}`
  }

  if (visited.size >= MAX_PARENT_DEPTH) {
    throw new Error(
      `[payload-paths] Parent chain deeper than ${MAX_PARENT_DEPTH} levels in "${collection.slug}" — aborting path computation.`,
    )
  }

  const ownId = extractRelationId(doc.id)
  if (ownId != null) {
    visited.add(String(ownId))
  }
  if (visited.has(String(parentId))) {
    throw new Error(
      `[payload-paths] Circular parent chain detected in "${collection.slug}" (document ${String(parentId)} is its own ancestor).`,
    )
  }
  visited.add(String(parentId))

  const parentPath = await resolveParentPath(ctx, parentId, visited)
  if (parentPath == null) {
    return null
  }

  return appendSegment(parentPath, slug)
}

/**
 * Read a parent's stored path, computing it recursively only when missing.
 * A dangling parent reference (deleted doc) resolves to `null`, making the
 * child unroutable rather than crashing the save.
 */
const resolveParentPath = async (
  ctx: ComputePathContext,
  parentId: number | string,
  visited: Set<string>,
): Promise<null | string> => {
  const { collection, payload, req } = ctx

  let parentDoc: JsonObject | null = null
  try {
    parentDoc = (await payload.findByID({
      id: parentId,
      collection: collection.slug,
      depth: 0,
      req,
      select: {
        [collection.parentField]: true,
        [collection.slugField]: true,
        path: true,
      },
    })) as JsonObject
  } catch {
    return null
  }

  if (!parentDoc) {
    return null
  }

  const storedPath = parentDoc.path
  if (typeof storedPath === 'string' && storedPath.startsWith('/')) {
    return storedPath
  }

  return computeDocPath(ctx, parentDoc, visited)
}

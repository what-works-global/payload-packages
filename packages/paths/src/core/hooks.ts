import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeChangeHook,
  JsonObject,
  PayloadRequest,
  SanitizedCollectionConfig,
  Where,
} from 'payload'

import { ValidationError } from 'payload'

import type { OnPathChanged, ResolvedPathsPluginConfig } from '../types.js'
import type { PathsCache, ResolvedPathsCollection } from './shared.js'

import { computeDocPath, extractRelationId } from './computePath.js'
import { appendSegment, collectionTag, composeUrl, normalizeScopeValue, pathTag } from './shared.js'

/** `req.context` flag marking cascade re-saves, so they skip the subtree pre-flight. */
const CASCADE_CONTEXT_FLAG = 'payloadPathsCascade'
/** `req.context` counter bounding cascade recursion against legacy data cycles. */
const CASCADE_DEPTH_CONTEXT = 'payloadPathsCascadeDepth'
const MAX_CASCADE_DEPTH = 32

const draftsEnabled = (collection: SanitizedCollectionConfig): boolean =>
  Boolean(collection.versions?.drafts)

/** Merge incoming (partial) data over the original doc, ignoring `undefined`. */
const mergedValue = (
  data: JsonObject,
  originalDoc: JsonObject | undefined,
  key: string,
): unknown => (data[key] === undefined ? originalDoc?.[key] : data[key])

const scopeWhere = (resolved: ResolvedPathsCollection, scope: null | string): Where[] =>
  resolved.scopeField ? [{ [resolved.scopeField]: { equals: scope } }] : []

const invalidateTags = async (
  cache: PathsCache,
  tags: string[],
  req: PayloadRequest,
): Promise<void> => {
  if (tags.length === 0) {
    return
  }
  try {
    await cache.invalidate([...new Set(tags)])
  } catch (error) {
    req.payload.logger.warn(error, '[payload-paths] Cache invalidation failed')
  }
}

/**
 * Walk the document's subtree (via the parent relationship) and throw a
 * `ValidationError` if moving it to `newPath` would land any descendant on a
 * path already occupied outside the subtree. Bounded by
 * `maxCascadePreflight`; oversized subtrees skip the check with a warning —
 * the per-document collision check still guards each cascaded save.
 */
const assertSubtreeMovable = async (
  resolved: ResolvedPathsCollection,
  plugin: ResolvedPathsPluginConfig,
  args: {
    docId: number | string
    draftsEnabled: boolean
    newPath: string
    oldPath: string
    req: PayloadRequest
    scope: null | string
  },
): Promise<void> => {
  const { docId, newPath, oldPath, req, scope } = args
  const { payload } = req

  const descendants: { id: number | string; path: unknown }[] = []
  const seen = new Set<string>([String(docId)])
  let frontier: (number | string)[] = [docId]

  while (frontier.length > 0) {
    const result = await payload.find({
      collection: resolved.slug,
      depth: 0,
      draft: false,
      pagination: false,
      req,
      select: { path: true },
      where: { [resolved.parentField]: { in: frontier } },
    })

    const fresh = result.docs.filter((doc) => !seen.has(String(doc.id)))
    for (const doc of fresh) {
      seen.add(String(doc.id))
    }
    descendants.push(...(fresh as { id: number | string; path: unknown }[]))

    if (descendants.length > plugin.maxCascadePreflight) {
      payload.logger.warn(
        `[payload-paths] "${resolved.slug}" subtree under ${String(docId)} exceeds maxCascadePreflight (${plugin.maxCascadePreflight}) — skipping the collision pre-flight for this move.`,
      )
      return
    }

    frontier = fresh.map((doc) => doc.id)
  }

  const futurePaths = descendants
    .map((doc) =>
      typeof doc.path === 'string' && doc.path.startsWith(`${oldPath}/`)
        ? `${newPath}${doc.path.slice(oldPath.length)}`
        : null,
    )
    .filter((path): path is string => path !== null)

  if (futurePaths.length === 0) {
    return
  }

  const clashes = await payload.find({
    collection: resolved.slug,
    depth: 0,
    draft: false,
    limit: 5,
    req,
    select: { path: true },
    where: {
      and: [
        { path: { in: futurePaths } },
        { id: { not_in: [docId, ...descendants.map((doc) => doc.id)] } },
        ...scopeWhere(resolved, scope),
        ...(args.draftsEnabled ? [{ _status: { equals: 'published' } }] : []),
      ],
    },
  })

  if (clashes.docs.length > 0) {
    const taken = clashes.docs
      .map((doc) => (doc as JsonObject).path)
      .filter((path): path is string => typeof path === 'string')
    throw new ValidationError({
      collection: resolved.slug,
      errors: [
        {
          message: `Moving this document would clash with existing URLs: ${taken.join(', ')}. Change the slug, or move/rename the documents already at those paths.`,
          path: resolved.slugField,
        },
      ],
    })
  }
}

/**
 * Reject re-parenting a document under itself or one of its own descendants.
 * The path computation cannot catch this by itself — it trusts a parent's
 * STORED path, which looks perfectly valid on a descendant — and an accepted
 * cycle would send the cascade into an endless path-growing loop. The chain
 * is walked by ids (never stored paths) upward from the new parent.
 */
const assertNoCycle = async (
  resolved: ResolvedPathsCollection,
  args: { ownId: number | string; parentId: number | string; req: PayloadRequest },
): Promise<void> => {
  const { ownId, parentId, req } = args
  const seen = new Set<string>([String(ownId)])
  let current: null | number | string = parentId

  while (current != null) {
    if (seen.has(String(current))) {
      throw new ValidationError({
        collection: resolved.slug,
        errors: [
          {
            message: 'A document cannot be nested under itself or one of its own descendants.',
            path: resolved.parentField,
          },
        ],
      })
    }
    seen.add(String(current))

    try {
      const ancestor = (await req.payload.findByID({
        id: current,
        collection: resolved.slug,
        depth: 0,
        req,
        select: { [resolved.parentField]: true },
      })) as JsonObject
      current = extractRelationId(ancestor[resolved.parentField])
    } catch {
      return
    }
  }
}

/**
 * Recompute `path` on every create/update, and — at publish time — enforce
 * uniqueness (per scope) with a friendly error on the slug field, plus the
 * subtree pre-flight when the path changed. Draft saves (including autosave)
 * always succeed: collisions are surfaced when they'd become public.
 */
export const createPathsBeforeChangeHook = (
  resolved: ResolvedPathsCollection,
  plugin: ResolvedPathsPluginConfig,
): CollectionBeforeChangeHook => {
  return async ({ collection, context, data, operation, originalDoc, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return data
    }

    const merged: JsonObject = { ...(originalDoc ?? {}), ...data }
    for (const key of Object.keys(data)) {
      if (data[key] === undefined && originalDoc && key in originalDoc) {
        merged[key] = originalDoc[key]
      }
    }

    if (resolved.strategy !== 'flat' && operation === 'update' && originalDoc?.id != null) {
      const incomingParent = extractRelationId(data[resolved.parentField])
      const previousParent = extractRelationId(originalDoc[resolved.parentField])
      if (data[resolved.parentField] !== undefined && incomingParent !== previousParent) {
        if (incomingParent != null && String(incomingParent) === String(originalDoc.id)) {
          throw new ValidationError({
            collection: resolved.slug,
            errors: [
              { message: 'A document cannot be its own parent.', path: resolved.parentField },
            ],
          })
        }
        if (incomingParent != null) {
          await assertNoCycle(resolved, {
            ownId: originalDoc.id as number | string,
            parentId: incomingParent,
            req,
          })
        }
      }
    }

    let path: null | string = null
    try {
      path = await computeDocPath({ collection: resolved, payload: req.payload, req }, merged)
    } catch (error) {
      throw new ValidationError({
        collection: resolved.slug,
        errors: [
          {
            message: error instanceof Error ? error.message : 'Could not compute the URL path.',
            path: resolved.parentField,
          },
        ],
      })
    }

    data.path = path

    // Publish-time enforcement. `data._status` is authoritative when present;
    // an update that omits it inherits the document's current status, so a
    // rename of a published document is still checked. Draft saves (including
    // autosave, and drafts of never-published documents) are never blocked.
    const incomingStatus =
      data._status ?? (operation === 'update' ? originalDoc?._status : undefined)
    const publishing = !draftsEnabled(collection) || incomingStatus === 'published'
    if (!publishing || path == null) {
      return data
    }

    const scope = resolved.scopeField
      ? normalizeScopeValue(mergedValue(data, originalDoc ?? undefined, resolved.scopeField))
      : null

    // Only PUBLISHED documents hold a public claim on a path: with drafts
    // enabled, `draft: false` still returns never-published documents (their
    // main doc carries `_status: 'draft'`), and a competing draft must not
    // block a publish — first to publish wins.
    const clash = await req.payload.find({
      collection: resolved.slug,
      depth: 0,
      draft: false,
      limit: 1,
      req,
      select: { path: true },
      where: {
        and: [
          { path: { equals: path } },
          ...(originalDoc?.id != null ? [{ id: { not_equals: originalDoc.id } }] : []),
          ...scopeWhere(resolved, scope),
          ...(draftsEnabled(collection) ? [{ _status: { equals: 'published' } }] : []),
        ],
      },
    })

    if (clash.docs.length > 0) {
      throw new ValidationError({
        collection: resolved.slug,
        errors: [
          {
            message: `A document already lives at ${composeUrl(resolved.prefix, path)}. Change the slug or pick a different parent.`,
            path: resolved.slugField,
          },
        ],
      })
    }

    const oldPath = typeof originalDoc?.path === 'string' ? originalDoc.path : null
    const isCascadeSave = Boolean(context?.[CASCADE_CONTEXT_FLAG])
    if (
      resolved.cascade !== 'none' &&
      !isCascadeSave &&
      oldPath !== null &&
      oldPath !== path &&
      originalDoc?.id != null
    ) {
      await assertSubtreeMovable(resolved, plugin, {
        docId: originalDoc.id as number | string,
        draftsEnabled: draftsEnabled(collection),
        newPath: path,
        oldPath,
        req,
        scope,
      })
    }

    return data
  }
}

const runOnPathChanged = async (
  handlers: OnPathChanged[],
  event: Parameters<OnPathChanged>[0],
): Promise<void> => {
  for (const handler of handlers) {
    try {
      await handler(event)
    } catch (error) {
      event.req.payload.logger.error(
        error,
        `[payload-paths] onPathChanged handler failed for ${event.collection} (${event.newPath ?? event.previousPath ?? 'unknown path'})`,
      )
    }
  }
}

/**
 * After a change: invalidate the affected path tags (old and new), notify
 * `onPathChanged` handlers, and — for the `'parent'` strategy — re-save the
 * document's children so their paths follow (the nested-docs strategy leaves
 * that cascade to the nested-docs plugin).
 */
export const createPathsAfterChangeHook = (
  resolved: ResolvedPathsCollection,
  plugin: ResolvedPathsPluginConfig,
): CollectionAfterChangeHook => {
  return async ({ collection, context, doc, operation, previousDoc, req }) => {
    const oldPath = typeof previousDoc?.path === 'string' ? previousDoc.path : null
    const newPath = typeof doc?.path === 'string' ? doc.path : null
    const oldScope = resolved.scopeField
      ? normalizeScopeValue(previousDoc?.[resolved.scopeField])
      : null
    const newScope = resolved.scopeField ? normalizeScopeValue(doc?.[resolved.scopeField]) : null

    const tags: string[] = []
    if (oldPath !== null) {
      tags.push(pathTag(resolved.slug, oldScope, oldPath))
    }
    if (newPath !== null) {
      tags.push(pathTag(resolved.slug, newScope, newPath))
    }
    await invalidateTags(plugin.cache, tags, req)

    const pathChanged = oldPath !== newPath || oldScope !== newScope
    if (pathChanged) {
      await runOnPathChanged(plugin.onPathChanged, {
        collection: resolved.slug,
        doc,
        newPath,
        newUrl: newPath === null ? null : composeUrl(resolved.prefix, newPath),
        operation: operation === 'create' ? 'create' : 'update',
        previousDoc,
        previousPath: oldPath,
        previousUrl: oldPath === null ? null : composeUrl(resolved.prefix, oldPath),
        req,
      })
    }

    const published = !draftsEnabled(collection) || doc._status === 'published'
    // On a publish-from-draft transition the path was already rewritten during
    // the earlier draft save, so `previousDoc` (that prior draft) carries the
    // NEW path and `pathChanged` reads false — yet the *published* subtree is
    // still stale (the draft save never cascaded). Treat any draft→published
    // transition as a trigger too; the per-child skip below keeps the work to
    // genuinely-stale descendants, so an ordinary content-only publish costs
    // just one children lookup. No-drafts collections never take this branch
    // (they have no draft phase), so their behavior is unchanged.
    const becamePublished =
      draftsEnabled(collection) &&
      doc._status === 'published' &&
      previousDoc?._status !== 'published'
    if (resolved.cascade !== 'internal' || !published || !(pathChanged || becamePublished)) {
      return doc
    }

    const cascadeDepth = Number(context?.[CASCADE_DEPTH_CONTEXT] ?? 0)
    if (cascadeDepth >= MAX_CASCADE_DEPTH) {
      req.payload.logger.error(
        `[payload-paths] Cascade depth limit reached under "${resolved.slug}" ${String(doc.id)} — the tree likely contains a cycle. Descendant paths may be stale; run verifyPathIntegrity after fixing the hierarchy.`,
      )
      return doc
    }

    // Re-save children so their beforeChange hooks recompute paths from this
    // document's freshly-stored path; each child save recurses one level down.
    // Mirrors nested-docs' resaveChildren draft semantics: a published child is
    // republished, a draft child stays a draft. A child whose stored path
    // already matches what this parent implies is skipped — no needless re-save,
    // no deeper cascade — which is what makes triggering on every publish cheap.
    const parentPath = typeof doc.path === 'string' ? doc.path : null
    const children = await req.payload.find({
      collection: resolved.slug,
      depth: 0,
      draft: false,
      pagination: false,
      req,
      select: { _status: true, path: true, [resolved.slugField]: true },
      where: { [resolved.parentField]: { equals: doc.id } },
    })

    for (const child of children.docs) {
      const childRecord = child as JsonObject
      const childSlug = childRecord[resolved.slugField]
      // A direct child's path is its parent's stored path + its own slug; a
      // child with no slug (or an unroutable parent) is expected to be pathless.
      const expectedChildPath =
        parentPath !== null && typeof childSlug === 'string' && childSlug !== ''
          ? appendSegment(parentPath, childSlug)
          : null
      const storedChildPath = typeof childRecord.path === 'string' ? childRecord.path : null
      if (storedChildPath === expectedChildPath) {
        continue
      }

      const childIsDraft = draftsEnabled(collection) && childRecord._status !== 'published'
      try {
        await req.payload.update({
          id: child.id,
          collection: resolved.slug,
          context: {
            ...context,
            [CASCADE_CONTEXT_FLAG]: true,
            [CASCADE_DEPTH_CONTEXT]: cascadeDepth + 1,
          },
          data: {},
          depth: 0,
          draft: childIsDraft,
          req,
        })
      } catch (error) {
        // The parent is already saved; a failed child leaves a stale path that
        // the next save or `backfillPaths`/`verifyPathIntegrity` repairs.
        req.payload.logger.error(
          error,
          `[payload-paths] Failed to cascade a path update to "${resolved.slug}" child ${String(child.id)}`,
        )
      }
    }

    return doc
  }
}

/**
 * After a delete: invalidate the path's cache tags, notify handlers, and warn
 * when children were left behind (their parent reference now dangles, so they
 * are unroutable until re-parented).
 */
export const createPathsAfterDeleteHook = (
  resolved: ResolvedPathsCollection,
  plugin: ResolvedPathsPluginConfig,
): CollectionAfterDeleteHook => {
  return async ({ doc, req }) => {
    const path = typeof doc?.path === 'string' ? doc.path : null
    const scope = resolved.scopeField ? normalizeScopeValue(doc?.[resolved.scopeField]) : null

    const tags = [collectionTag(resolved.slug)]
    if (path !== null) {
      tags.push(pathTag(resolved.slug, scope, path))
    }
    await invalidateTags(plugin.cache, tags, req)

    if (path !== null) {
      await runOnPathChanged(plugin.onPathChanged, {
        collection: resolved.slug,
        doc: null,
        newPath: null,
        newUrl: null,
        operation: 'delete',
        previousDoc: doc,
        previousPath: path,
        previousUrl: composeUrl(resolved.prefix, path),
        req,
      })
    }

    if (resolved.strategy !== 'flat') {
      try {
        const orphans = await req.payload.count({
          collection: resolved.slug,
          req,
          where: { [resolved.parentField]: { equals: doc.id } },
        })
        if (orphans.totalDocs > 0) {
          req.payload.logger.warn(
            `[payload-paths] Deleted "${resolved.slug}" document ${String(doc.id)} leaves ${orphans.totalDocs} child document(s) with a dangling parent — they are unroutable until re-parented.`,
          )
        }
      } catch (error) {
        req.payload.logger.warn(error, '[payload-paths] Orphan check after delete failed')
      }
    }

    return doc
  }
}

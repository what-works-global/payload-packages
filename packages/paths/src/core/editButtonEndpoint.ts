/**
 * The edit-button endpoint: one authenticated GET that answers both questions
 * the frontend component has — "am I an editor?" (401 when not) and "which
 * document is this pathname?" (resolved across every configured collection,
 * most-specific prefix first, with admin URLs composed server-side so the
 * client never needs to know how the admin is mounted).
 */
import type { CollectionSlug, Endpoint, PayloadRequest, SanitizedCollectionConfig } from 'payload'

import { formatAdminURL } from 'payload/shared'

import type { EditButtonOptions, ResolvedPathsPluginConfig } from '../types.js'
import type {
  EditButtonAncestor,
  EditButtonContext,
  EditButtonDoc,
  EditButtonDocStatus,
  EditButtonURLs,
} from './editButtonContract.js'
import type { ResolvedPathsCollection } from './shared.js'

import { createPathsResolver, createResolverChain } from '../exports/resolver.js'
import { DEFAULT_EDIT_BUTTON_ENDPOINT_PATH } from './editButtonContract.js'
import { composeUrl, pathToSegments } from './shared.js'

type ResolvedDoc = {
  [key: string]: unknown
  _status?: unknown
  id: number | string
  updatedAt?: unknown
}

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { headers: { 'Cache-Control': 'no-store' }, status })

const hasDrafts = (collection: SanitizedCollectionConfig): boolean =>
  Boolean(typeof collection.versions === 'object' && collection.versions?.drafts)

const titleFieldFor = (collection: SanitizedCollectionConfig): null | string => {
  const useAsTitle = collection.admin?.useAsTitle
  return useAsTitle && useAsTitle !== 'id' ? useAsTitle : null
}

const titleOf = (
  doc: Record<string, unknown>,
  titleField: null | string,
  fallback: string,
): string => {
  const value = titleField ? doc[titleField] : undefined
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

const labelOf = (collection: SanitizedCollectionConfig): string => {
  const singular = collection.labels?.singular
  return typeof singular === 'string' ? singular : collection.slug
}

const hasLivePreview = (collection: SanitizedCollectionConfig, req: PayloadRequest): boolean =>
  Boolean(
    collection.admin?.livePreview ||
      req.payload.config.admin?.livePreview?.collections?.includes(collection.slug),
  )

/**
 * Version state in the admin's vocabulary. The main document row holds the
 * latest PUBLISHED state once a doc has ever been published (else the draft),
 * so `main._status === 'draft'` means never published; a published main doc
 * whose newest version is a draft means "changed".
 */
const statusOf = async (
  req: PayloadRequest,
  collection: SanitizedCollectionConfig,
  id: number | string,
): Promise<EditButtonDocStatus | null> => {
  if (!hasDrafts(collection)) {
    return null
  }
  const slug = collection.slug
  const main = (await req.payload.findByID({
    id,
    collection: slug,
    depth: 0,
    disableErrors: true,
    draft: false,
    req,
    select: { _status: true },
  })) as null | ResolvedDoc
  if (main?._status !== 'published') {
    return 'draft'
  }
  const latest = (await req.payload.findByID({
    id,
    collection: slug,
    depth: 0,
    disableErrors: true,
    draft: true,
    req,
    select: { _status: true },
  })) as null | ResolvedDoc
  return latest?._status === 'draft' ? 'changed' : 'published'
}

/**
 * Ancestors derived from the stored path itself — one `path IN [...]` query
 * instead of walking the parent relationship chain, so it costs the same for
 * a 2-level and a 10-level tree and never depends on populated relations.
 */
const ancestorsOf = async (
  req: PayloadRequest,
  resolved: ResolvedPathsCollection,
  collection: SanitizedCollectionConfig,
  path: string,
  scope: null | string,
  draft: boolean,
  adminRoute: string,
  serverURL: string | undefined,
): Promise<EditButtonAncestor[]> => {
  if (resolved.strategy === 'flat') {
    return []
  }
  const segments = pathToSegments(path)
  if (segments.length < 2) {
    return []
  }
  const parentPaths = segments
    .slice(0, -1)
    .map((_, index) => `/${segments.slice(0, index + 1).join('/')}`)

  const titleField = titleFieldFor(collection)
  const result = await req.payload.find({
    collection: resolved.slug,
    depth: 0,
    draft,
    pagination: false,
    req,
    select: {
      path: true,
      ...(titleField ? { [titleField]: true } : {}),
    },
    where: {
      and: [
        { path: { in: parentPaths } },
        ...(resolved.scopeField ? [{ [resolved.scopeField]: { equals: scope } }] : []),
      ],
    },
  })

  return (result.docs as ResolvedDoc[])
    .filter((doc): doc is { path: string } & ResolvedDoc => typeof doc.path === 'string')
    .sort((a, b) => pathToSegments(a.path).length - pathToSegments(b.path).length)
    .map((doc) => ({
      id: doc.id,
      editURL: formatAdminURL({
        adminRoute,
        path: `/collections/${resolved.slug}/${doc.id}`,
        serverURL,
      }),
      title: titleOf(doc, titleField, composeUrl(resolved.prefix, doc.path)),
      url: composeUrl(resolved.prefix, doc.path),
    }))
}

/**
 * Build the GET endpoint. Registered on the root config by `pathsPlugin` when
 * `editButton` is enabled; the handler runs after Payload's auth strategies,
 * so `req.user` is already populated (or null) when it executes.
 */
export const createEditButtonEndpoint = (
  resolvedPlugin: ResolvedPathsPluginConfig,
  options: EditButtonOptions,
): Endpoint => ({
  handler: async (req: PayloadRequest): Promise<Response> => {
    const { payload, user } = req

    if (!user) {
      return json({ error: 'Unauthorized' }, 401)
    }
    // Default gate: only users of the ADMIN auth collection. Sites with
    // public-facing auth collections (customers, members) must not leak draft
    // existence — or grow an edit button — for ordinary logged-in visitors.
    if (options.access) {
      if (!(await options.access({ req }))) {
        return json({ error: 'Forbidden' }, 403)
      }
    } else if (user.collection !== payload.config.admin.user) {
      return json({ error: 'Forbidden' }, 403)
    }

    const pathnameRaw = req.searchParams?.get('pathname')
    if (typeof pathnameRaw !== 'string' || !pathnameRaw.startsWith('/')) {
      return json({ error: 'A `pathname` query parameter starting with "/" is required.' }, 400)
    }
    const scope = req.searchParams.get('scope')
    const wantDraft = req.searchParams.get('draft') === '1'

    const adminRoute = payload.config.routes.admin
    const apiRoute = payload.config.routes.api
    const serverURL = payload.config.serverURL || undefined

    const urls: EditButtonURLs = {
      account: formatAdminURL({ adminRoute, path: '/account', serverURL }),
      admin: formatAdminURL({ adminRoute, path: null, serverURL }),
      // Composed by hand: formatAdminURL only understands `apiRoute` from
      // Payload 3.69, and the peer floor is 3.54 (older versions silently
      // drop the `/api` prefix).
      logout: `${serverURL ?? ''}${apiRoute === '/' ? '' : apiRoute}/${user.collection}/logout`,
    }
    const respond = (doc: EditButtonDoc | null): Response =>
      json({
        doc,
        urls,
        user: {
          id: user.id,
          collection: user.collection,
          email: typeof user.email === 'string' ? user.email : null,
        },
      } satisfies EditButtonContext)

    // One resolver per collection (each with its own title-field select),
    // chained so pathname resolution ranks by prefix specificity — identical
    // ordering to the public-site resolver chain.
    const getPayload = (): Promise<typeof payload> => Promise.resolve(payload)
    const resolvers = Object.values(resolvedPlugin.collections).map((resolved) => {
      const collection = payload.collections[resolved.slug]?.config
      const titleField = collection ? titleFieldFor(collection) : null
      return createPathsResolver<ResolvedDoc>({
        collection: resolved.slug,
        config: {
          collections: {
            [resolved.slug]: {
              prefix: resolved.prefix,
              ...(resolved.scopeField ? { scopeField: resolved.scopeField } : {}),
            },
          },
        },
        depth: 0,
        getPayload,
        select: {
          path: true,
          updatedAt: true,
          ...(titleField ? { [titleField]: true } : {}),
        },
      })
    })
    const chain = createResolverChain<ResolvedDoc>(resolvers)

    // Resolve one pathname, following at most one canonical redirect
    // (`/page/1` → the bare path can never redirect again).
    const resolveOnce = async (pathname: string, draft: boolean) => {
      const resolution = await chain.resolve({ draft, pathname, scope })
      return resolution.type === 'redirect'
        ? chain.resolve({ draft, pathname: resolution.redirectTo, scope })
        : resolution
    }

    // Resolve what the visitor is looking at (published on the live site,
    // newest version in draft mode) — then fall back to drafts so an editor
    // staring at a 404 still gets a button for the unpublished doc that will
    // live at that URL.
    let resolution = await resolveOnce(pathnameRaw, wantDraft)
    if (resolution.type !== 'found' && !wantDraft) {
      resolution = await resolveOnce(pathnameRaw, true)
    }
    if (resolution.type !== 'found') {
      return respond(null)
    }

    const resolved = resolvedPlugin.collections[resolution.collection]
    // Cast once for consumers' generated types (CollectionSlug is a literal
    // union there); a no-op in this package, same as the resolver's cast.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const collection = payload.collections[resolution.collection as CollectionSlug]?.config
    if (!resolved || !collection) {
      return respond(null)
    }

    const doc = resolution.doc
    const titleField = titleFieldFor(collection)
    const editURL = formatAdminURL({
      adminRoute,
      path: `/collections/${collection.slug}/${doc.id}`,
      serverURL,
    })
    const [status, ancestors] = await Promise.all([
      statusOf(req, collection, doc.id),
      ancestorsOf(
        req,
        resolved,
        collection,
        resolution.path,
        scope,
        wantDraft,
        adminRoute,
        serverURL,
      ),
    ])

    return respond({
      id: doc.id,
      ancestors,
      apiURL: collection.admin?.hideAPIURL ? null : `${editURL}/api`,
      collection: collection.slug,
      collectionLabel: labelOf(collection),
      editURL,
      path: resolution.path,
      previewURL: hasLivePreview(collection, req) ? `${editURL}/preview` : null,
      status,
      title: titleOf(doc, titleField, resolution.url),
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
      url: resolution.url,
      versionsURL: collection.versions ? `${editURL}/versions` : null,
    })
  },
  method: 'get',
  path: options.endpointPath ?? DEFAULT_EDIT_BUTTON_ENDPOINT_PATH,
})

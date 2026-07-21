import type {
  ActivityLogEvents,
  CollectionSnapshotMode,
  GlobalSnapshotMode,
  ResolveActivityDocumentLabel,
  ResolveActivityIpAddress,
  ResolveActivityRequestHost,
  ResolveActivityUserLabel,
} from './types.js'

export const defaultCollectionSlug = 'activity-log'

export const defaultEvents: Required<ActivityLogEvents> = {
  autosave: false,
  create: true,
  delete: true,
  login: true,
  logout: true,
  restore: true,
  trash: true,
  update: true,
}

/** Snapshot on permanent delete only — versioned collections rely on the version link. */
export const defaultCollectionSnapshotMode: CollectionSnapshotMode = 'delete'

/** Globals aren't snapshotted by default; opt in per global (or set the scope default). */
export const defaultGlobalSnapshotMode: GlobalSnapshotMode = 'never'

/**
 * Default IP resolution when `ipAddress: true`: the standard reverse-proxy
 * headers, most trustworthy first. Which of these your deployment can actually
 * trust depends on its proxy chain — pass a custom `ipAddress` resolver when
 * in doubt.
 */
export const defaultResolveIpAddress: ResolveActivityIpAddress = ({ req }) => {
  const candidates = [
    req.headers.get('cf-connecting-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for')?.split(',')[0],
  ]
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return null
}

/**
 * Default host resolution when `requestHost: true`: the forwarded host set by a
 * reverse proxy, falling back to the request's own `host` header. Whether
 * `x-forwarded-host` can be trusted depends on your proxy chain — pass a custom
 * `requestHost` resolver when in doubt.
 */
export const defaultResolveRequestHost: ResolveActivityRequestHost = ({ req }) => {
  const candidates = [req.headers.get('x-forwarded-host')?.split(',')[0], req.headers.get('host')]
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return null
}

export const defaultResolveUserLabel: ResolveActivityUserLabel = ({ user }) => {
  const label = user.email ?? user.username ?? user.id
  return label == null ? null : String(label)
}

export const defaultResolveDocumentLabel: ResolveActivityDocumentLabel = ({
  collectionSlug,
  doc,
  globalSlug,
  req,
}) => {
  if (globalSlug) {
    const label = req.payload.globals?.config?.find((global) => global.slug === globalSlug)?.label
    return typeof label === 'string' ? label : globalSlug
  }

  // Auth collections without an explicit `admin.useAsTitle` sanitize to `'id'`,
  // which would defeat the whole point of storing a title — skip it and fall
  // through to the common candidates.
  const useAsTitle = collectionSlug
    ? req.payload.collections?.[collectionSlug]?.config?.admin?.useAsTitle
    : undefined

  const candidates = [
    useAsTitle && useAsTitle !== 'id' ? doc[useAsTitle] : null,
    doc.title,
    doc.name,
    doc.email,
    doc.username,
    doc.id,
  ]

  for (const candidate of candidates) {
    if (candidate != null && candidate !== '') {
      return String(candidate)
    }
  }
  return null
}

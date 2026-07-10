import type {
  ActivityLogEvents,
  ResolveActivityDocumentLabel,
  ResolveActivityIpAddress,
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

export const defaultSnapshotMode = 'delete'

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

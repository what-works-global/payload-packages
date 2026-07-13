import type { PayloadRequest } from 'payload'

import { permissionCovers } from '../permissions.js'
import { getRbacCustomConfig } from '../shared.js'

const emptySet: ReadonlySet<string> = new Set()

/**
 * Access functions run once per collection and operation when the admin panel
 * computes permissions, so the resolved set is memoized per request. Roles
 * referenced by ID cost at most one indexed find per request.
 */
const requestCache = new WeakMap<PayloadRequest, Promise<ReadonlySet<string>>>()

const normalizeRoleValue = (
  entry: unknown,
): { id: number | string } | { permissions: string[] } | null => {
  if (typeof entry === 'number' || typeof entry === 'string') {
    return { id: entry }
  }
  if (entry && typeof entry === 'object') {
    const doc = entry as Record<string, unknown>
    if (Array.isArray(doc.permissions)) {
      return { permissions: doc.permissions.filter((p): p is string => typeof p === 'string') }
    }
    if (typeof doc.id === 'number' || typeof doc.id === 'string') {
      return { id: doc.id }
    }
  }
  return null
}

const resolvePermissions = async (req: PayloadRequest): Promise<ReadonlySet<string>> => {
  const custom = getRbacCustomConfig(req.payload.config)
  if (!custom || !req.user) {
    return emptySet
  }

  const value = (req.user as Record<string, unknown>)[custom.rolesFieldName]
  if (!Array.isArray(value) || value.length === 0) {
    return emptySet
  }

  const permissions = new Set<string>()
  const idsToFetch: (number | string)[] = []

  // `req.user` carries role IDs at the default auth depth 0, or populated role
  // documents at depth > 0 — use in-document permissions when present.
  for (const entry of value) {
    const normalized = normalizeRoleValue(entry)
    if (!normalized) {
      continue
    }
    if ('permissions' in normalized) {
      for (const permission of normalized.permissions) {
        permissions.add(permission)
      }
    } else {
      idsToFetch.push(normalized.id)
    }
  }

  if (idsToFetch.length > 0) {
    // System read: a user's permissions must resolve even when they cannot read
    // the roles collection themselves.
    const { docs } = await req.payload.find({
      collection: custom.rolesCollectionSlug,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      where: { id: { in: idsToFetch } },
    })
    for (const doc of docs) {
      if (Array.isArray(doc.permissions)) {
        for (const permission of doc.permissions) {
          if (typeof permission === 'string') {
            permissions.add(permission)
          }
        }
      }
    }
  }

  return permissions
}

/**
 * Resolves the union of permission strings granted by the requesting user's roles.
 * Memoized per request; returns an empty set for unauthenticated requests.
 */
export const getUserPermissions = (req: PayloadRequest): Promise<ReadonlySet<string>> => {
  if (!req.user) {
    return Promise.resolve(emptySet)
  }
  const cached = requestCache.get(req)
  if (cached) {
    return cached
  }
  const resolved = resolvePermissions(req)
  requestCache.set(req, resolved)
  return resolved
}

/**
 * Whether the requesting user holds a permission — directly or through a
 * wildcard (`'posts:*'`, `'*:update'`, `'*'`), e.g.
 * `await hasPermission(req, 'posts:update')`.
 */
export const hasPermission = async (req: PayloadRequest, permission: string): Promise<boolean> => {
  const permissions = await getUserPermissions(req)
  return permissionCovers(permissions, permission)
}

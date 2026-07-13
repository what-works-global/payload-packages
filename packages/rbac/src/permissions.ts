import type { RbacAction } from './shared.js'

import { collectionActions } from './shared.js'

/** Grants every action on every controlled collection and global. */
export const FULL_ACCESS = '*'

/** Builds the permission string for one action on one collection or global. */
export const permissionFor = (slug: string, action: RbacAction): string => `${slug}:${action}`

/**
 * Whether a permission set amounts to full access: the `'*'` token, or an
 * `'*:<action>'` wildcard for every action — the action set is closed, so
 * together they cover everything `'*'` covers, present and future entities
 * included.
 */
export const fullAccessPermissions = (permissions: ReadonlySet<string>): boolean => {
  return (
    permissions.has(FULL_ACCESS) ||
    collectionActions.every((action) => permissions.has(`*:${action}`))
  )
}

/**
 * Whether a granted permission set covers one required permission, wildcards
 * included:
 * - `'<slug>:<action>'` is covered by itself, `'<slug>:*'`, `'*:<action>'`, or
 *   full access.
 * - `'<slug>:*'` is additionally covered by holding every action on that slug
 *   individually — the action set is closed, so the expansion is exact.
 * - `'*:<action>'` spans entities added in the future, so nothing short of
 *   itself or full access covers it.
 */
export const permissionCovers = (granted: ReadonlySet<string>, required: string): boolean => {
  if (granted.has(required) || fullAccessPermissions(granted)) {
    return true
  }
  const separator = required.indexOf(':')
  if (separator === -1) {
    return false
  }
  const slug = required.slice(0, separator)
  const action = required.slice(separator + 1)
  if (slug === '*') {
    return false
  }
  if (action === '*') {
    return collectionActions.every(
      (each) => granted.has(permissionFor(slug, each)) || granted.has(`*:${each}`),
    )
  }
  return granted.has(`${slug}:*`) || granted.has(`*:${action}`)
}

/** Whether a permission set grants an action on a collection or global. */
export const permissionsGrant = (
  permissions: ReadonlySet<string>,
  slug: string,
  action: RbacAction,
): boolean => {
  return permissionCovers(permissions, permissionFor(slug, action))
}

/**
 * Order-insensitive equality between a stored permissions value (unknown shape —
 * may be missing or malformed) and a code-defined permission list. Used by the
 * protected-role guard and the drift repair in seeding.
 */
export const samePermissions = (value: unknown, permissions: readonly string[]): boolean => {
  const stored = new Set(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
  )
  const expected = new Set(permissions)
  return stored.size === expected.size && [...expected].every((entry) => stored.has(entry))
}

/**
 * The subset of `required` not covered by `granted`. Used by the privilege-escalation
 * guards: an empty result means the grantor holds everything they are handing out.
 */
export const missingPermissions = (
  granted: ReadonlySet<string>,
  required: readonly string[],
): string[] => {
  return required.filter((permission) => !permissionCovers(granted, permission))
}

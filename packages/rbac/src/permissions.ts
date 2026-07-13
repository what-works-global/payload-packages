import type { RbacAction } from './shared.js'

/** Grants every action on every controlled collection and global. */
export const FULL_ACCESS = '*'

/** Builds the permission string for one action on one collection or global. */
export const permissionFor = (slug: string, action: RbacAction): string => `${slug}:${action}`

/** Whether a permission set grants an action on a collection or global. */
export const permissionsGrant = (
  permissions: ReadonlySet<string>,
  slug: string,
  action: RbacAction,
): boolean => {
  return permissions.has(FULL_ACCESS) || permissions.has(permissionFor(slug, action))
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
  if (granted.has(FULL_ACCESS)) {
    return []
  }
  return required.filter((permission) => !granted.has(permission))
}

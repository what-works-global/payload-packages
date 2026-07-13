import type { Config } from 'payload'

export const pluginKey = '@whatworks/payload-rbac'

export const permissionsMatrixFieldPath = `${pluginKey}/client#PermissionsMatrixField`

/** Actions available on a collection. */
export const collectionActions = ['create', 'read', 'update', 'delete'] as const

/** Actions available on a global. */
export const globalActions = ['read', 'update'] as const

export type RbacAction = (typeof collectionActions)[number]

/**
 * One row of the permissions matrix shown on a role document — a collection or
 * global together with the actions that can be granted on it. Serialized into the
 * matrix field component's `clientProps`, so it must stay JSON-safe.
 */
export type MatrixRow = {
  actions: readonly RbacAction[]
  entity: 'collection' | 'global'
  label: string
  slug: string
}

/**
 * Plugin state stored on `config.custom[pluginKey]` so exported helpers
 * (`getUserPermissions`, `hasPermission`) can find the roles collection and the
 * roles field without access to the plugin closure. The root `custom` key is a
 * server-only config property, stripped from the client config.
 */
export type RbacCustomConfig = {
  rolesCollectionSlug: string
  rolesFieldName: string
  userCollections: string[]
}

export const getRbacCustomConfig = (
  config: { custom?: Record<string, unknown> } | Config,
): RbacCustomConfig | undefined => {
  return config.custom?.[pluginKey] as RbacCustomConfig | undefined
}

import type { CollectionConfig, Config, Field, GlobalConfig, Plugin } from 'payload'

import type { MatrixRow, RbacCustomConfig } from './shared.js'
import type { RbacEntitySelection, RbacPluginConfig } from './types.js'

import { createRbacAccess } from './access/rbacAccess.js'
import { createRolesFieldAccess } from './access/rolesFieldAccess.js'
import { createRolesCollection } from './collections/createRolesCollection.js'
import { createRolesField } from './fields/createRolesField.js'
import { createAssignFirstUserRoleHook } from './hooks/assignFirstUserRole.js'
import {
  createProtectAdminUsersChangeHook,
  createProtectAdminUsersDeleteHook,
} from './hooks/protectAdminUsers.js'
import { createProtectCredentialsHook } from './hooks/protectCredentials.js'
import {
  createProtectedRolesChangeHook,
  createProtectedRolesDeleteHook,
} from './hooks/protectedRoles.js'
import {
  createProtectLastAdminChangeHook,
  createProtectLastAdminDeleteHook,
} from './hooks/protectLastAdmin.js'
import { createProtectRolesCollectionHook } from './hooks/protectRolesCollection.js'
import { createProtectRolesFieldHook } from './hooks/protectRolesField.js'
import { FULL_ACCESS, permissionFor } from './permissions.js'
import { seedPredefinedRoles } from './seed.js'
import { collectionActions, globalActions, pluginKey } from './shared.js'
import { entityLabel } from './utilities/entityLabel.js'
import {
  anyUserHoldsRole,
  findFullAccessRoleIds,
  warnIfAdminRoleUnheld,
} from './utilities/fullAccessHolders.js'

const createSelector = <TSlug extends string>(
  selection: RbacEntitySelection<TSlug> | undefined,
): ((slug: string) => boolean) => {
  if (selection === undefined || selection === true) {
    return () => true
  }
  if (Array.isArray(selection)) {
    const included = new Set<string>(selection)
    return (slug) => included.has(slug)
  }
  const excluded = new Set<string>(selection.exclude)
  return (slug) => !excluded.has(slug)
}

const hasNamedField = (fields: Field[], name: string): boolean => {
  return fields.some((field) => 'name' in field && field.name === name)
}

const resolveUserCollections = (config: Config, pluginConfig: RbacPluginConfig): string[] => {
  if (pluginConfig.userCollections?.length) {
    return pluginConfig.userCollections
  }
  const authSlugs = (config.collections ?? [])
    .filter((collection) => Boolean(collection.auth))
    .map((collection) => collection.slug)
  if (authSlugs.length) {
    return authSlugs
  }
  return [config.admin?.user ?? 'users']
}

export const rbacPlugin = (pluginConfig: RbacPluginConfig = {}): Plugin => {
  return (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }

    if (pluginConfig.enabled === false) {
      return config
    }

    const rolesCollectionSlug = pluginConfig.rolesCollection?.slug ?? 'roles'
    const rolesFieldName = pluginConfig.rolesField?.name ?? 'roles'
    const preventEscalation = pluginConfig.preventPrivilegeEscalation !== false
    const ownAccountActions =
      pluginConfig.ownAccountAccess === false
        ? []
        : (pluginConfig.ownAccountAccess ?? ['read', 'update'])
    const adminRole: { description?: string; name?: string } =
      !pluginConfig.adminRole || typeof pluginConfig.adminRole === 'string'
        ? { name: pluginConfig.adminRole || undefined }
        : pluginConfig.adminRole

    if (adminRole.name && (pluginConfig.roles ?? []).some((role) => role.name === adminRole.name)) {
      throw new Error(
        `[payload-rbac] "${adminRole.name}" is the adminRole and is defined by the plugin — ` +
          `it always has permissions ['*'] and is protected. Remove it from roles, or use a different name.`,
      )
    }

    // The admin role is always full-access and protected: an unprotected one can
    // be downgraded irreversibly — once nobody holds a permission, the escalation
    // guard blocks everyone from granting it back. Its credentials are always
    // self-only: with `users:update` enough to set an administrator's password
    // or email, any admin account could be taken over by another.
    const predefinedRoles = [
      ...(adminRole.name
        ? [
            {
              name: adminRole.name,
              credentialChanges: 'self' as const,
              description: adminRole.description ?? 'Full access to everything.',
              permissions: [FULL_ACCESS],
              protected: true,
            },
          ]
        : []),
      ...(pluginConfig.roles ?? []).map((role) => ({
        ...role,
        protected: role.protected ?? false,
      })),
    ]
    const protectedRoles = predefinedRoles.filter((role) => role.protected)
    const protectedRoleNames = protectedRoles.map((role) => role.name)
    // Credentials are self-only for every role — including roles defined only in
    // the database — so the guard only needs the explicit opt-outs. Everything
    // not on this list (the default) is protected.
    const anyoneCredentialRoleNames = predefinedRoles
      .filter((role) => role.credentialChanges === 'anyone')
      .map((role) => role.name)

    if ((config.collections ?? []).some((collection) => collection.slug === rolesCollectionSlug)) {
      throw new Error(
        `[payload-rbac] A collection with the slug "${rolesCollectionSlug}" already exists. ` +
          `Pass rolesCollection.slug to use a different slug for the roles collection.`,
      )
    }

    const shouldControlCollection = createSelector(pluginConfig.collections)
    const shouldControlGlobal = createSelector(pluginConfig.globals)
    const userCollections = resolveUserCollections(config, pluginConfig)
    const adminUserCollection = config.admin?.user ?? 'users'

    const matrixRows: MatrixRow[] = [
      ...(config.collections ?? [])
        .filter((collection) => shouldControlCollection(collection.slug))
        .map((collection) => ({
          slug: collection.slug,
          actions: collectionActions,
          entity: 'collection' as const,
          label: entityLabel(collection.labels?.plural, collection.slug),
        })),
      {
        slug: rolesCollectionSlug,
        actions: collectionActions,
        entity: 'collection' as const,
        label: 'Roles',
      },
      ...(config.globals ?? [])
        .filter((global) => shouldControlGlobal(global.slug))
        .map((global) => ({
          slug: global.slug,
          actions: globalActions,
          entity: 'global' as const,
          label: entityLabel(global.label, global.slug),
        })),
    ]

    const validPermissions = new Set<string>([
      FULL_ACCESS,
      ...collectionActions.map((action) => `*:${action}`),
      ...matrixRows.flatMap((row) => [
        `${row.slug}:*`,
        ...row.actions.map((action) => permissionFor(row.slug, action)),
      ]),
    ])
    for (const role of predefinedRoles) {
      for (const permission of role.permissions) {
        if (!validPermissions.has(permission)) {
          throw new Error(
            `[payload-rbac] Predefined role "${role.name}" grants unknown permission "${permission}". ` +
              `Permissions must be '*', '<slug>:<action>', '<slug>:*', or '*:<action>' for a ` +
              `controlled collection (create/read/update/delete) or global (read/update).`,
          )
        }
      }
    }

    // Explicit access defined on a collection wins for that operation; the plugin
    // only fills the gaps. Compose `requirePermission` into your own access
    // functions to combine both.
    const withCollectionAccess = (collection: CollectionConfig): CollectionConfig => {
      const access = { ...collection.access }
      for (const action of collectionActions) {
        if (access[action] === undefined) {
          access[action] = createRbacAccess({ slug: collection.slug, action, ownAccountActions })
        }
      }
      if (access.readVersions === undefined) {
        access.readVersions = createRbacAccess({ slug: collection.slug, action: 'read' })
      }
      if (access.unlock === undefined) {
        access.unlock = createRbacAccess({ slug: collection.slug, action: 'update' })
      }
      return { ...collection, access }
    }

    const withGlobalAccess = (global: GlobalConfig): GlobalConfig => {
      const access = { ...global.access }
      for (const action of globalActions) {
        if (access[action] === undefined) {
          access[action] = createRbacAccess({ slug: global.slug, action })
        }
      }
      if (access.readVersions === undefined) {
        access.readVersions = createRbacAccess({ slug: global.slug, action: 'read' })
      }
      return { ...global, access }
    }

    // Changing role membership requires `roles:update`. Field-level access is
    // what makes the admin panel render the field read-only for everyone else,
    // so a user can never accidentally remove their own roles — a hook would
    // only reject the save after the fact. While no administrator exists the
    // field stays writable, or the break-glass self-claim could never reach the
    // escalation guard that vets it.
    const rolesFieldAccess = createRolesFieldAccess({
      rolesCollectionSlug,
      rolesFieldName,
      ...(adminRole.name ? { breakGlass: { userCollections } } : {}),
    })

    const withRolesField = (collection: CollectionConfig): CollectionConfig => {
      // If the collection already defines a field with this name, leave the field
      // entirely user-managed — the guard hooks still apply to it, but the
      // `roles:update` field gate does not.
      const fields = hasNamedField(collection.fields, rolesFieldName)
        ? collection.fields
        : [
            ...collection.fields,
            createRolesField({
              name: rolesFieldName,
              access: { create: rolesFieldAccess, update: rolesFieldAccess },
              override: pluginConfig.rolesField?.override,
              rolesCollectionSlug,
            }),
          ]

      const beforeChange = [...(collection.hooks?.beforeChange ?? [])]
      const beforeDelete = [...(collection.hooks?.beforeDelete ?? [])]
      if (adminRole.name) {
        // Runs before the other admin guards so a user below the admin tier gets
        // one clear "only an administrator can touch this account" answer for any
        // create/update/delete of an administrator, rather than a per-aspect
        // message from the credential, roles-field, or last-admin guards.
        const protectAdminUsersArgs = {
          adminRoleName: adminRole.name,
          rolesCollectionSlug,
          rolesFieldName,
          userCollectionSlug: collection.slug,
        }
        beforeChange.push(createProtectAdminUsersChangeHook(protectAdminUsersArgs))
        beforeDelete.push(createProtectAdminUsersDeleteHook(protectAdminUsersArgs))
      }
      // Always installed: credentials are self-only by default for every role,
      // and roles created in the database aren't known at config time, so the
      // guard has to be present even when no role is predefined.
      beforeChange.push(
        createProtectCredentialsHook({
          anyoneRoleNames: anyoneCredentialRoleNames,
          rolesCollectionSlug,
          rolesFieldName,
          userCollectionSlug: collection.slug,
        }),
      )
      if (preventEscalation || adminRole.name) {
        beforeChange.push(
          createProtectRolesFieldHook({
            preventEscalation,
            rolesCollectionSlug,
            rolesFieldName,
            ...(adminRole.name
              ? {
                  // Break-glass: with no administrator left (database-level
                  // damage), denying a self-claim would leave the system
                  // unrecoverable.
                  breakGlass: { adminRoleName: adminRole.name, userCollections },
                  // Only holders may grant the admin tier — a client
                  // administrator holding '*' through another role must not be
                  // able to join it on their own.
                  holderOnly: { roleNames: [adminRole.name], userCollections },
                }
              : {}),
          }),
        )
      }
      if (adminRole.name) {
        // There must always be at least one user holding the admin role: with
        // nobody left holding '*', the escalation guard would block every path
        // to assigning it again.
        const protectLastAdminArgs = {
          adminRoleName: adminRole.name,
          rolesCollectionSlug,
          rolesFieldName,
          userCollections,
          userCollectionSlug: collection.slug,
        }
        beforeChange.push(createProtectLastAdminChangeHook(protectLastAdminArgs))
        beforeDelete.push(createProtectLastAdminDeleteHook(protectLastAdminArgs))
      }
      if (adminRole.name && collection.slug === adminUserCollection) {
        beforeChange.push(
          createAssignFirstUserRoleHook({
            firstUserRole: adminRole.name,
            rolesCollectionSlug,
            rolesFieldName,
          }),
        )
      }

      return { ...collection, fields, hooks: { ...collection.hooks, beforeChange, beforeDelete } }
    }

    const rolesAccess: CollectionConfig['access'] = {}
    for (const action of collectionActions) {
      rolesAccess[action] = createRbacAccess({ slug: rolesCollectionSlug, action })
    }
    if (adminRole.name) {
      const baseRead = rolesAccess.read
      // Break-glass visibility: while no user holds full access, signed-in users
      // may read roles — the account page must be able to list the admin role
      // for the self-claim, and nothing here is sensitive.
      rolesAccess.read = async (args) => {
        const base = await baseRead?.(args)
        if (base || !args.req.user) {
          return base ?? false
        }
        const fullAccessRoleIds = await findFullAccessRoleIds(args.req.payload, rolesCollectionSlug)
        return !(await anyUserHoldsRole(args.req.payload, fullAccessRoleIds, {
          rolesFieldName,
          userCollections,
        }))
      }
    }

    // The protected-role guard runs before the escalation guard so its clearer
    // error wins, and it applies even when preventPrivilegeEscalation is off —
    // the two solve different problems.
    const rolesBeforeChange: NonNullable<CollectionConfig['hooks']>['beforeChange'] = []
    if (protectedRoles.length > 0) {
      rolesBeforeChange.push(createProtectedRolesChangeHook({ protectedRoles }))
    }
    if (preventEscalation) {
      rolesBeforeChange.push(createProtectRolesCollectionHook({ protectedRoleNames }))
    }
    const rolesHooks: CollectionConfig['hooks'] = {
      ...(rolesBeforeChange.length > 0 ? { beforeChange: rolesBeforeChange } : {}),
      ...(protectedRoles.length > 0
        ? {
            beforeDelete: [
              createProtectedRolesDeleteHook({ protectedRoleNames, rolesCollectionSlug }),
            ],
          }
        : {}),
    }

    const rolesCollection = createRolesCollection({
      slug: rolesCollectionSlug,
      access: rolesAccess,
      hooks: Object.keys(rolesHooks).length > 0 ? rolesHooks : undefined,
      matrixRows,
      override: pluginConfig.rolesCollection?.override,
      protectedRoleNames,
    })

    config.collections = [
      ...(config.collections ?? []).map((collection) => {
        let result = shouldControlCollection(collection.slug)
          ? withCollectionAccess(collection)
          : collection
        if (userCollections.includes(collection.slug)) {
          result = withRolesField(result)
        }
        return result
      }),
      rolesCollection,
    ]

    config.globals = (config.globals ?? []).map((global) =>
      shouldControlGlobal(global.slug) ? withGlobalAccess(global) : global,
    )

    const incomingOnInit = config.onInit
    config.onInit = async (payload) => {
      if (predefinedRoles.length > 0) {
        await seedPredefinedRoles(payload, { roles: predefinedRoles, rolesCollectionSlug })
      }
      if (adminRole.name) {
        await warnIfAdminRoleUnheld(payload, {
          adminRoleName: adminRole.name,
          rolesCollectionSlug,
          rolesFieldName,
          userCollections,
        })
      }
      await incomingOnInit?.(payload)
    }

    const customConfig: RbacCustomConfig = {
      rolesCollectionSlug,
      rolesFieldName,
      userCollections,
    }

    config.custom = {
      ...config.custom,
      [pluginKey]: customConfig,
    }

    return config
  }
}

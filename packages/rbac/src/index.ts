export {
  createRbacAccess,
  type CreateRbacAccessArgs,
  requirePermission,
} from './access/rbacAccess.js'
export {
  createRolesFieldAccess,
  type CreateRolesFieldAccessArgs,
} from './access/rolesFieldAccess.js'
export {
  createRolesCollection,
  type CreateRolesCollectionArgs,
} from './collections/createRolesCollection.js'
export { createRolesField, type CreateRolesFieldArgs } from './fields/createRolesField.js'
export {
  type AssignFirstUserRoleArgs,
  createAssignFirstUserRoleHook,
} from './hooks/assignFirstUserRole.js'
export {
  createProtectCredentialsHook,
  type ProtectCredentialsArgs,
} from './hooks/protectCredentials.js'
export {
  createProtectedRolesChangeHook,
  createProtectedRolesDeleteHook,
  type ProtectedRolesChangeArgs,
  type ProtectedRolesDeleteArgs,
} from './hooks/protectedRoles.js'
export {
  createProtectLastAdminChangeHook,
  createProtectLastAdminDeleteHook,
  type ProtectLastAdminArgs,
} from './hooks/protectLastAdmin.js'
export {
  createProtectRolesCollectionHook,
  type ProtectRolesCollectionArgs,
} from './hooks/protectRolesCollection.js'
export {
  createProtectRolesFieldHook,
  normalizeRoleIds,
  type ProtectRolesFieldArgs,
} from './hooks/protectRolesField.js'
export {
  FULL_ACCESS,
  fullAccessPermissions,
  missingPermissions,
  permissionCovers,
  permissionFor,
  permissionsGrant,
  samePermissions,
} from './permissions.js'
export { rbacPlugin } from './plugin.js'
export { seedPredefinedRoles, type SeedPredefinedRolesArgs } from './seed.js'
export {
  collectionActions,
  getRbacCustomConfig,
  globalActions,
  type MatrixRow,
  permissionsMatrixFieldPath,
  pluginKey,
  type RbacAction,
  type RbacCustomConfig,
} from './shared.js'
export type {
  PredefinedRole,
  RbacEntitySelection,
  RbacPermission,
  RbacPluginConfig,
} from './types.js'
export { entityLabel } from './utilities/entityLabel.js'
export {
  anyUserHoldsRole,
  findFullAccessRoleIds,
  type RoleHolderQueryArgs,
  warnIfAdminRoleUnheld,
  type WarnIfAdminRoleUnheldArgs,
} from './utilities/fullAccessHolders.js'
export { getUserPermissions, hasPermission } from './utilities/getUserPermissions.js'
export {
  isWriteConflict,
  retryOnWriteConflict,
  type RetryOnWriteConflictOptions,
} from './utilities/retryOnWriteConflict.js'

export {
  getActivityLogCollection,
  type GetActivityLogCollectionArgs,
} from './collections/getActivityLogCollection.js'
export {
  defaultCollectionSlug,
  defaultEvents,
  defaultResolveDocumentLabel,
  defaultResolveIpAddress,
  defaultResolveUserLabel,
  defaultSnapshotMode,
} from './defaults.js'
export {
  type ActivityHookContext,
  createActivityEntry,
  type CreateActivityEntryArgs,
} from './hooks/createActivityEntry.js'
export { logAfterLogin, logAfterLogout } from './hooks/logAuthActivity.js'
export {
  logCollectionAfterChange,
  logCollectionAfterDelete,
} from './hooks/logCollectionActivity.js'
export { logGlobalAfterChange } from './hooks/logGlobalActivity.js'
export { activityLogPlugin } from './plugin.js'
export {
  type ActivityLogCustomConfig,
  auditFieldsPluginKey,
  documentCellComponentPath,
  getActivityLogCustomConfig,
  pluginKey,
  userCellComponentPath,
  userFieldComponentPath,
  versionCellComponentPath,
} from './shared.js'
export type {
  ActivityEntitySelection,
  ActivityLogEvents,
  ActivityLogPluginConfig,
  ActivityOperation,
  ActivitySnapshotMode,
  ActivityUserRef,
  ResolveActivityDocumentLabel,
  ResolveActivityIpAddress,
  ResolveActivityUser,
  ResolveActivityUserLabel,
} from './types.js'
export { getChangedFields } from './utilities/getChangedFields.js'
export { normalizeUserRef } from './utilities/normalizeUserRef.js'

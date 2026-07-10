import type { Config } from 'payload'

import type { ActivityLogEvents, ActivitySnapshotMode, ResolveActivityUserLabel } from './types.js'

export const pluginKey = '@whatworks/payload-activity-log'

/**
 * `config.custom` key written by `@whatworks/payload-audit-fields`. When present,
 * its `resolveUserLabel` is reused (unless overridden) so both plugins display
 * users identically. Read duck-typed — there is no hard dependency between the
 * two packages.
 */
export const auditFieldsPluginKey = '@whatworks/payload-audit-fields'

export const documentCellComponentPath = `${pluginKey}/rsc#ActivityDocumentCell`

export const userCellComponentPath = `${pluginKey}/rsc#ActivityUserCell`

export const userFieldComponentPath = `${pluginKey}/rsc#ActivityUserField`

export const versionCellComponentPath = `${pluginKey}/rsc#ActivityVersionCell`

/**
 * Plugin state stored on `config.custom[pluginKey]` so components resolved through
 * the import map (which have no access to the plugin closure) can read the
 * plugin's configuration.
 *
 * The root `custom` key is a server-only config property — it is stripped from the
 * client config — so holding functions here is safe.
 */
export type ActivityLogCustomConfig = {
  collectionSlug: string
  events: Required<ActivityLogEvents>
  /** Whether opt-in IP address tracking is enabled. */
  ipAddress: boolean
  resolveUserLabel: null | ResolveActivityUserLabel
  retention: { maxAgeDays: number } | null
  snapshot: ActivitySnapshotMode
  userCollections: string[]
}

export const getActivityLogCustomConfig = (
  config: { custom?: Record<string, unknown> } | Config,
): ActivityLogCustomConfig | undefined => {
  return config.custom?.[pluginKey] as ActivityLogCustomConfig | undefined
}

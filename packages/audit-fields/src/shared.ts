import type { Config } from 'payload'

import type { ResolveAuditUserLabel } from './types.js'

export const pluginKey = '@whatworks/payload-audit-fields'

export const versionsViewComponentPath = `${pluginKey}/rsc#AuditVersionsView`

export const auditUserFieldComponentPath = `${pluginKey}/rsc#AuditUserField`

export const auditUserCellComponentPath = `${pluginKey}/rsc#AuditUserCell`

/**
 * Plugin state stored on `config.custom[pluginKey]` so the components resolved
 * through the import map (the versions view and the audit field display), which
 * have no access to the plugin closure, can read the plugin's configuration.
 *
 * The root `custom` key is a server-only config property — it is stripped from the
 * client config — so holding a function here is safe.
 */
export type AuditFieldsCustomConfig = {
  createdByFieldName: null | string
  lastModifiedByFieldName: null | string
  resolveUserLabel: ResolveAuditUserLabel
  userCollections: string[]
  versionsColumnLabel: null | Record<string, string> | string
}

export const getAuditFieldsCustomConfig = (
  config: { custom?: Record<string, unknown> } | Config,
): AuditFieldsCustomConfig | undefined => {
  return config.custom?.[pluginKey] as AuditFieldsCustomConfig | undefined
}

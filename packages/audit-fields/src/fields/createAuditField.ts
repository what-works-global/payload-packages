import type { RelationshipField } from 'payload'

import type { AuditFieldLabel } from '../types.js'

import { auditUserCellComponentPath, auditUserFieldComponentPath } from '../shared.js'
import { resolveLabel } from '../utilities/resolveLabel.js'

export type CreateAuditFieldArgs = {
  entitySlug: string
  index: boolean
  label: AuditFieldLabel
  name: string
  override?: (field: RelationshipField) => RelationshipField
  showInSidebar: boolean
  userCollections: string[]
}

/**
 * Builds a read-only polymorphic relationship field pointing at the configured
 * user collections. The value shape (`{ relationTo, value }`) is identical to the
 * one used by `@payload-bites/audit-fields`, so existing data carries over.
 *
 * The field renders through the plugin's `AuditUserField` display component (document
 * view) and `AuditUserCell` (list view), which both show the resolved user label
 * (default: email) linked to the user document. Use `override` to remove
 * `admin.components.Field` / `admin.components.Cell` if you want the default
 * relationship input and cell back.
 */
export const createAuditField = ({
  name,
  entitySlug,
  index,
  label,
  override,
  showInSidebar,
  userCollections,
}: CreateAuditFieldArgs): RelationshipField => {
  const field: RelationshipField = {
    name,
    type: 'relationship',
    admin: {
      allowCreate: false,
      allowEdit: false,
      components: {
        Cell: auditUserCellComponentPath,
        Field: auditUserFieldComponentPath,
      },
      condition: (data) => Boolean(data?.[name]),
      disableBulkEdit: true,
      position: showInSidebar ? 'sidebar' : undefined,
      readOnly: true,
    },
    index: index || undefined,
    label: resolveLabel(label, entitySlug),
    maxDepth: 0,
    relationTo: userCollections,
  }

  return override ? override(field) : field
}

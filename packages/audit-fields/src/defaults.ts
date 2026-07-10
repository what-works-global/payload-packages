import type { ResolveAuditUserLabel } from './types.js'

export const defaultCreatedByField = {
  name: 'createdBy',
  label: 'Created By',
} as const

export const defaultLastModifiedByField = {
  name: 'lastModifiedBy',
  label: 'Last Modified By',
} as const

export const defaultVersionsColumnLabel = 'Modified By'

export const defaultResolveUserLabel: ResolveAuditUserLabel = ({ user }) => {
  const label = user.email ?? user.username ?? user.id
  return label == null ? null : String(label)
}

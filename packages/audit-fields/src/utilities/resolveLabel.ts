import type { AuditFieldLabel } from '../types.js'

export const resolveLabel = (
  label: AuditFieldLabel,
  slug: string,
): Record<string, string> | string => {
  return typeof label === 'function' ? label(slug) : label
}

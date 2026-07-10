import type { AuditUserRef } from '../types.js'

/**
 * Accepts whatever a document or version snapshot holds for an audit field and
 * normalizes it to a `{ relationTo, value }` ref. The plugin stores the polymorphic
 * shape, but be lenient about plain IDs (single `relationTo` via field override)
 * and populated docs (custom fetch depth).
 */
export const normalizeUserRef = (
  raw: unknown,
  fallbackCollection?: string,
): AuditUserRef | null => {
  if (raw == null) {
    return null
  }

  if (typeof raw === 'string' || typeof raw === 'number') {
    return fallbackCollection ? { relationTo: fallbackCollection, value: raw } : null
  }

  if (typeof raw === 'object') {
    const ref = raw as { id?: number | string; relationTo?: unknown; value?: unknown }

    if (typeof ref.relationTo === 'string') {
      const value =
        typeof ref.value === 'object' && ref.value !== null
          ? (ref.value as { id?: number | string }).id
          : ref.value
      if (typeof value === 'string' || typeof value === 'number') {
        return { relationTo: ref.relationTo, value }
      }
      return null
    }

    if (ref.id != null && fallbackCollection) {
      return { relationTo: fallbackCollection, value: ref.id }
    }
  }

  return null
}

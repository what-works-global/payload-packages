import type { JsonObject } from 'payload'

/**
 * Bookkeeping keys that carry no signal of their own: `id`/timestamps change on
 * every save, and `deletedAt` transitions surface as `trash`/`restore` operations
 * rather than as a changed field.
 */
const ALWAYS_IGNORED = ['id', '_id', 'createdAt', 'deletedAt', 'globalType', 'updatedAt']

const isEqualValue = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true
  }
  if (a == null || b == null) {
    // Treat null and undefined (field absent vs cleared) as the same value.
    return a == null && b == null
  }
  try {
    // Dates serialize to their ISO string, so a Date on one side and its string
    // form on the other compare equal.
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Top-level field names whose value differs between the previous and current
 * document. Names only, no values — enough to render "updated title, content"
 * in the feed without storing document data.
 */
export const getChangedFields = ({
  doc,
  ignore = [],
  previousDoc,
}: {
  doc: JsonObject | null | undefined
  ignore?: string[]
  previousDoc: JsonObject | null | undefined
}): string[] => {
  if (!doc || !previousDoc) {
    return []
  }

  const ignored = new Set([...ALWAYS_IGNORED, ...ignore])
  const keys = new Set([...Object.keys(doc), ...Object.keys(previousDoc)])
  const changed: string[] = []

  for (const key of keys) {
    if (ignored.has(key)) {
      continue
    }
    if (!isEqualValue(doc[key], previousDoc[key])) {
      changed.push(key)
    }
  }

  return changed.sort()
}

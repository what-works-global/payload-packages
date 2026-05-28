import type { Field, RelationshipField, TextField } from 'payload'

import type { SelectSearchFunction } from './types.js'

export type SelectSearchRelationConfig = {
  /** Collection slug to store this field as a Payload relationship. When set,
   *  the underlying field type becomes `relationship` (storing references —
   *  ObjectId on Mongo, FK on SQL) and list-view cells render via Payload's
   *  default relationship cell. Drop-in replacement for an existing
   *  `relationship` field — existing data remains compatible.
   */
  to: string
}

export type SelectSearchConfig = {
  /** Debounce timings for client-side option refetching.
   */
  debounce?: SelectSearchDebounceConfig
  /** Send full form data to `searchFunction` as `data` on each request.
   * @default false
   */
  passDataToSearchFunction?: boolean
  /** Send sibling field data to `searchFunction` as `siblingData` on each request.
   * @default false
   */
  passSiblingDataToSearchFunction?: boolean
  searchFunction: SelectSearchFunction
  /** Re-fetch options when any of these field values change
   * @default []
   */
  watchFieldPaths?: string[]
}

export type SelectSearchDebounceConfig = {
  /** Debounce delay (ms) for query typing changes.
   * @default 300
   */
  query?: number
  /** Debounce delay (ms) for watched field value changes.
   * @default 700
   */
  watchedFields?: number
}

export type SelectSearchFieldArgs = {
  admin?: RelationshipField['admin'] | TextField['admin']
  custom?: Record<string, unknown>
  hasMany?: boolean
  /** When provided, the field is stored as a Payload relationship to this
   *  collection instead of a plain text field. See [[SelectSearchRelationConfig]].
   */
  relation?: SelectSearchRelationConfig
  search: SelectSearchConfig
  type?: 'text'
} & Omit<TextField, 'admin' | 'custom' | 'hasMany' | 'type'>

const normalizeWatchFieldPaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const paths = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)

  return Array.from(new Set(paths)).sort()
}

const normalizeDebounceMs = (
  value: unknown,
  fallback: number,
  key: 'query' | 'watchedFields',
): number => {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid search.debounce.${key}: expected a finite number >= 0`)
  }

  return Math.floor(value)
}

export const selectSearch = (args: SelectSearchFieldArgs): Field => {
  const { type: _type, relation, search, ...rest } = args

  const resolvedPassDataToSearchFunction = search.passDataToSearchFunction === true
  const resolvedPassSiblingDataToSearchFunction = search.passSiblingDataToSearchFunction === true
  const resolvedWatchFieldPaths = normalizeWatchFieldPaths(search.watchFieldPaths)
  const resolvedQueryDebounceMs = normalizeDebounceMs(search.debounce?.query, 300, 'query')
  const resolvedWatchedFieldsDebounceMs = normalizeDebounceMs(
    search.debounce?.watchedFields,
    700,
    'watchedFields',
  )

  const fieldShape = relation
    ? { type: 'relationship' as const, relationTo: relation.to }
    : { type: 'text' as const }

  return {
    ...rest,
    ...fieldShape,
    admin: {
      ...args.admin,
      components: {
        ...args.admin?.components,
        Field: {
          clientProps: {
            debounce: {
              query: resolvedQueryDebounceMs,
              watchedFields: resolvedWatchedFieldsDebounceMs,
            },
            passDataToSearchFunction: resolvedPassDataToSearchFunction,
            passSiblingDataToSearchFunction: resolvedPassSiblingDataToSearchFunction,
            watchFieldPaths: resolvedWatchFieldPaths,
          },
          path: '@whatworks/payload-select-search-field/client#SelectSearchField',
        },
      },
    },
    custom: {
      ...args.custom,
      searchFunction: search.searchFunction,
    },
  } as Field
}

export const selectSearchField = (args: SelectSearchFieldArgs): Field => {
  return selectSearch(args)
}

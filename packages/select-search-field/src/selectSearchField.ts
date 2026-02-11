import type { Field, TextField } from 'payload'

import type { SelectSearchFunction } from './types.js'

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
  admin?: TextField['admin']
  custom?: Record<string, unknown>
  hasMany?: boolean
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
  const { search, ...rest } = args

  const resolvedPassDataToSearchFunction = search.passDataToSearchFunction === true
  const resolvedPassSiblingDataToSearchFunction = search.passSiblingDataToSearchFunction === true
  const resolvedWatchFieldPaths = normalizeWatchFieldPaths(search.watchFieldPaths)
  const resolvedQueryDebounceMs = normalizeDebounceMs(search.debounce?.query, 300, 'query')
  const resolvedWatchedFieldsDebounceMs = normalizeDebounceMs(
    search.debounce?.watchedFields,
    700,
    'watchedFields',
  )

  return {
    ...rest,
    type: 'text',
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

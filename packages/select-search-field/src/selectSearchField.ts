import type { Field, TextField } from 'payload'

import type { SelectSearchFunction } from './types.js'

export type SelectSearchFieldArgs = {
  admin?: TextField['admin']
  custom?: Record<string, unknown>
  hasMany?: boolean
  searchFunction: SelectSearchFunction
  type?: 'text'
} & Omit<TextField, 'admin' | 'custom' | 'hasMany' | 'type'>

export const selectSearchField = (args: SelectSearchFieldArgs): Field => {
  const { searchFunction, ...rest } = args
  return {
    ...rest,
    type: 'text',
    admin: {
      ...args.admin,
      components: {
        ...args.admin?.components,
        Field:
          args.admin?.components?.Field ??
          '@whatworks/payload-select-search-field/client#SelectSearchField',
      },
    },
    custom: {
      ...args.custom,
      searchFunction,
    },
  } as Field
}

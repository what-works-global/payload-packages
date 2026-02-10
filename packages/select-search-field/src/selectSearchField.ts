import type { Field, TextField } from 'payload'
import type { SelectSearchFunction } from './types.js'

export type SelectSearchFieldArgs = Omit<TextField, 'admin' | 'custom' | 'type' | 'hasMany'> & {
  hasMany?: boolean
  type?: 'text'
  searchFunction: SelectSearchFunction
  custom?: Record<string, unknown>
  admin?: TextField['admin']
}

export const selectSearchField = (args: SelectSearchFieldArgs): Field => {
  const { searchFunction, ...rest } = args
  return {
    ...rest,
    type: 'text',
    custom: {
      ...args.custom,
      searchFunction: args.searchFunction,
    },
    admin: {
      ...args.admin,
      components: {
        ...args.admin?.components,
        Field:
          args.admin?.components?.Field ??
          '@whatworks/payload-select-search-field/client#SelectSearchField',
      },
    },
  } as Field
}

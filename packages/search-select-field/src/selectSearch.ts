import type { Field, TextField } from 'payload'
import type { SearchSelectFunction } from './types.js'

export type SelectSearchFieldArgs = Omit<TextField, 'admin' | 'custom' | 'type' | 'hasMany'> & {
  hasMany?: boolean
  type?: 'text'
  searchFunction: SearchSelectFunction
  custom?: Record<string, unknown>
  admin?: TextField['admin']
}

export const selectSearch = (args: SelectSearchFieldArgs): Field => {
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
          '@whatworks/payload-search-select-field/client#SearchSelectField',
      },
    },
  } as Field
}

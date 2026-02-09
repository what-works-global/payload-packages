import type { Field, TextField } from 'payload'
import type { SearchSelectFunction } from './types.js'

export type SelectSearchFieldArgs = Omit<TextField, 'custom' | 'type' | 'hasMany'> & {
  hasMany?: boolean
  custom: {
    searchFunction: SearchSelectFunction
  } & Record<string, unknown>
  type?: 'text'
}

export const selectSearch = (args: SelectSearchFieldArgs): Field => {
  return {
    ...args,
    type: 'text',
    custom: {
      ...args.custom,
      searchFunction: args.custom.searchFunction,
    },
  } as Field
}

import type { Field, TextField } from 'payload'

import type { SelectSearchFunction } from './types.js'

export type SelectSearchFieldArgs = {
  admin?: TextField['admin']
  custom?: Record<string, unknown>
  hasMany?: boolean
  /** Send full form data to `searchFunction` as `data` on each request.
   * @default false
   */
  passDataToSearchFunction?: boolean
  /** Send sibling field data to `searchFunction` as `siblingData` on each request.
   * @default false
   */
  passSiblingDataToSearchFunction?: boolean
  searchFunction: SelectSearchFunction
  type?: 'text'
} & Omit<TextField, 'admin' | 'custom' | 'hasMany' | 'type'>

export const selectSearchField = (args: SelectSearchFieldArgs): Field => {
  const { passDataToSearchFunction, passSiblingDataToSearchFunction, searchFunction, ...rest } =
    args

  const resolvedPassDataToSearchFunction =
    passDataToSearchFunction ??
    (args.custom as { passDataToSearchFunction?: boolean } | undefined)?.passDataToSearchFunction ??
    false
  const resolvedPassSiblingDataToSearchFunction =
    passSiblingDataToSearchFunction ??
    (args.custom as { passSiblingDataToSearchFunction?: boolean } | undefined)
      ?.passSiblingDataToSearchFunction ??
    false

  return {
    ...rest,
    type: 'text',
    admin: {
      ...args.admin,
      components: {
        ...args.admin?.components,
        Field: {
          clientProps: {
            passDataToSearchFunction: resolvedPassDataToSearchFunction,
            passSiblingDataToSearchFunction: resolvedPassSiblingDataToSearchFunction,
          },
          path: '@whatworks/payload-select-search-field/client#SelectSearchField',
        },
      },
    },
    custom: {
      ...args.custom,
      searchFunction,
    },
  } as Field
}

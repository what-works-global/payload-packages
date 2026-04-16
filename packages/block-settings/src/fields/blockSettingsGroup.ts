import type { Field, GroupField } from 'payload'

import {
  BLOCK_SETTINGS_CUSTOM_KEY,
  BLOCK_SETTINGS_HIDDEN_CLASS,
  DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
} from '../shared.js'
import type { BlockSettingsGroupOptions } from '../types.js'

type NamedGroupField = Extract<GroupField, { name: string }>

export const blockSettingsGroup = ({
  admin,
  fields,
  label = 'Settings',
  name = DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
  ...rest
}: BlockSettingsGroupOptions): NamedGroupField => {
  const className = [admin?.className, BLOCK_SETTINGS_HIDDEN_CLASS].filter(Boolean).join(' ')

  return {
    ...rest,
    admin: {
      ...admin,
      className,
      custom: {
        ...admin?.custom,
        [BLOCK_SETTINGS_CUSTOM_KEY]: true,
      },
    },
    fields: fields as Field[],
    label,
    name,
    type: 'group',
  }
}

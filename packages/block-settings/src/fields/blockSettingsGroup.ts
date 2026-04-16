import type { Field, GroupField } from 'payload'

import { BLOCK_SETTINGS_CUSTOM_KEY, DEFAULT_BLOCK_SETTINGS_FIELD_NAME } from '../shared.js'
import type { BlockSettingsGroupOptions } from '../types.js'

type NamedGroupField = Extract<GroupField, { name: string }>
const hiddenGroupFieldPath = '@whatworks/payload-block-settings/client#HiddenSettingsGroupField'

export const blockSettingsGroup = ({
  admin,
  fields,
  label = 'Settings',
  name = DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
  ...rest
}: BlockSettingsGroupOptions): NamedGroupField => {
  return {
    ...rest,
    admin: {
      ...admin,
      components: {
        ...admin?.components,
        Field: admin?.components?.Field ?? hiddenGroupFieldPath,
      },
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

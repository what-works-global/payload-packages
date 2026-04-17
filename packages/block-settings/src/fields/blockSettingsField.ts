import type { Field, GroupField } from 'payload'

import {
  BLOCK_SETTINGS_CANONICAL_CUSTOM_KEY,
  BLOCK_SETTINGS_CUSTOM_KEY,
  BLOCK_SETTINGS_LOCATION_CUSTOM_KEY,
  DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
  DEFAULT_BLOCK_SETTINGS_LOCATION,
} from '../shared.js'
import type { BlockSettingsFieldOptions } from '../types.js'

type NamedGroupField = Extract<GroupField, { name: string }>
const hiddenGroupFieldPath = '@whatworks/payload-block-settings/client#HiddenSettingsGroupField'

export const blockSettingsField = ({
  admin,
  fields,
  label = 'Settings',
  name = DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
  settings,
  ...rest
}: BlockSettingsFieldOptions): NamedGroupField => {
  const resolvedCanonical = settings?.canonical === true
  const resolvedLocation = settings?.location ?? DEFAULT_BLOCK_SETTINGS_LOCATION

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
        [BLOCK_SETTINGS_CANONICAL_CUSTOM_KEY]: resolvedCanonical,
        [BLOCK_SETTINGS_LOCATION_CUSTOM_KEY]: resolvedLocation,
        [BLOCK_SETTINGS_CUSTOM_KEY]: true,
      },
    },
    fields: fields as Field[],
    label,
    name,
    type: 'group',
  }
}

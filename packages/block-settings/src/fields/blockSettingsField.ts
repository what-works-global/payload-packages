import type { GroupField } from 'payload'

import type { BlockSettingsFieldOptions } from '../types.js'

import {
  BLOCK_SETTINGS_CANONICAL_CUSTOM_KEY,
  BLOCK_SETTINGS_CUSTOM_KEY,
  BLOCK_SETTINGS_LOCATION_CUSTOM_KEY,
  DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
  DEFAULT_BLOCK_SETTINGS_LOCATION,
} from '../shared.js'

type NamedGroupField = Extract<GroupField, { name: string }>
const hiddenGroupFieldPath = '@whatworks/payload-block-settings/client#HiddenSettingsGroupField'

export const blockSettingsField = ({
  name = DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
  admin,
  fields,
  label = 'Settings',
  settings,
  ...rest
}: BlockSettingsFieldOptions): NamedGroupField => {
  const resolvedCanonical = settings?.canonical === true
  const resolvedLocation = settings?.location ?? DEFAULT_BLOCK_SETTINGS_LOCATION

  return {
    ...rest,
    name,
    type: 'group',
    admin: {
      ...admin,
      components: {
        ...admin?.components,
        Field: admin?.components?.Field ?? hiddenGroupFieldPath,
      },
      custom: {
        ...admin?.custom,
        [BLOCK_SETTINGS_CANONICAL_CUSTOM_KEY]: resolvedCanonical,
        [BLOCK_SETTINGS_CUSTOM_KEY]: true,
        [BLOCK_SETTINGS_LOCATION_CUSTOM_KEY]: resolvedLocation,
      },
    },
    fields,
    label,
  }
}

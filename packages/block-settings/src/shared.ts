import type { ClientField, Field, GroupField } from 'payload'

export const BLOCK_SETTINGS_CUSTOM_KEY = 'blockSettings'
export const DEFAULT_BLOCK_SETTINGS_FIELD_NAME = 'settings'

type NamedGroupField = Extract<GroupField, { name: string }>

export const blockSettingsFieldMatches = (
  field: ClientField | Field,
  settingsFieldName = DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
): field is NamedGroupField => {
  if (!('name' in field) || field.type !== 'group' || field.name !== settingsFieldName) {
    return false
  }

  return Boolean(field.admin?.custom?.[BLOCK_SETTINGS_CUSTOM_KEY])
}

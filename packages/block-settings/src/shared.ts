import type { ClientField, Field, GroupField } from 'payload'

export const BLOCK_SETTINGS_CUSTOM_KEY = 'blockSettings'
export const BLOCK_SETTINGS_CANONICAL_CUSTOM_KEY = 'blockSettingsCanonical'
export const BLOCK_SETTINGS_LOCATION_CUSTOM_KEY = 'blockSettingsLocation'
export const DEFAULT_BLOCK_SETTINGS_FIELD_NAME = 'settings'
export const DEFAULT_BLOCK_SETTINGS_LOCATION = 'inline'

type NamedGroupField = Extract<GroupField, { name: string }>

export const blockSettingsFieldMatches = (field: ClientField | Field): field is NamedGroupField => {
  if (!('name' in field) || field.type !== 'group') {
    return false
  }

  return Boolean(field.admin?.custom?.[BLOCK_SETTINGS_CUSTOM_KEY])
}

export const blockSettingsFieldIsCanonical = (field: ClientField | Field): boolean => {
  if (!blockSettingsFieldMatches(field)) {
    return false
  }

  return Boolean(field.admin?.custom?.[BLOCK_SETTINGS_CANONICAL_CUSTOM_KEY])
}

export const getBlockSettingsFieldLocation = (field: ClientField | Field): 'drawer' | 'inline' => {
  if (!blockSettingsFieldMatches(field)) {
    return DEFAULT_BLOCK_SETTINGS_LOCATION
  }

  const stored = field.admin?.custom?.[BLOCK_SETTINGS_LOCATION_CUSTOM_KEY]

  return stored === 'drawer' || stored === 'inline' ? stored : DEFAULT_BLOCK_SETTINGS_LOCATION
}

export const getBlockSettingsToggleSlug = (path: string): string => {
  return `${path}__block-settings`
}

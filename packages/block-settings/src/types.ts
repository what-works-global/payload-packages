import type { Field, GroupField } from 'payload'

import type { DEFAULT_BLOCK_SETTINGS_FIELD_NAME } from './shared.js'

type NamedGroupField = Extract<GroupField, { name: string }>

export interface BlockSettingsPluginOptions {
  readonly overrideExistingLabel?: boolean
  readonly settingsFieldName?: string
}

export type BlockSettingsFieldOptions = Omit<NamedGroupField, 'fields' | 'name' | 'type'> & {
  readonly fields: Field[]
  readonly name?: string
}

export type BlockSettingsLabelClientProps = {
  readonly settingsFieldName?: string
}

export type DefaultBlockSettingsFieldName = typeof DEFAULT_BLOCK_SETTINGS_FIELD_NAME

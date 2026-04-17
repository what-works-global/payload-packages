import type { Field, GroupField } from 'payload'

import type { DEFAULT_BLOCK_SETTINGS_FIELD_NAME } from './shared.js'

type NamedGroupField = Extract<GroupField, { name: string }>

export interface BlockSettingsFieldSettingsOptions {
  readonly canonical?: boolean
  readonly location?: 'drawer' | 'inline'
}

export type BlockSettingsFieldOptions = Omit<NamedGroupField, 'fields' | 'name' | 'type'> & {
  readonly fields: Field[]
  readonly name?: string
  readonly settings?: BlockSettingsFieldSettingsOptions
}

export interface BlockSettingsLabelClientProps {}

export type DefaultBlockSettingsFieldName = typeof DEFAULT_BLOCK_SETTINGS_FIELD_NAME

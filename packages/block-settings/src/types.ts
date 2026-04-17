import type { Field, GroupField } from 'payload'

import type { DEFAULT_BLOCK_SETTINGS_FIELD_NAME } from './shared.js'

type NamedGroupField = Extract<GroupField, { name: string }>

export interface BlockSettingsPluginOptions {
  readonly overrideExistingLabel?: boolean
}

export type BlockSettingsFieldOptions = Omit<NamedGroupField, 'fields' | 'name' | 'type'> & {
  readonly canonical?: boolean
  readonly fields: Field[]
  readonly location?: 'drawer' | 'inline'
  readonly name?: string
}

export type BlockSettingsLabelClientProps = Record<string, never>

export type DefaultBlockSettingsFieldName = typeof DEFAULT_BLOCK_SETTINGS_FIELD_NAME

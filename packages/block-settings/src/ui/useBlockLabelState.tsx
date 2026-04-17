'use client'

import type { ClientBlock, ClientField, SanitizedFieldPermissions } from 'payload'

import { getTranslation } from '@payloadcms/translations'
import { useConfig, useRowLabel, useTranslation } from '@payloadcms/ui'
import type { BlockSettingsLabelClientProps } from '../types.js'

export type BlockLabelActionProps = BlockSettingsLabelClientProps & {
  readonly field: ClientField & {
    readonly blockReferences?: (ClientBlock | string)[]
    readonly blocks?: ClientBlock[]
    readonly name: string
  }
  readonly permissions?: SanitizedFieldPermissions
  readonly readOnly?: boolean
  readonly schemaPath?: string
}

export type BlockLabelActionComponent = React.ComponentType<BlockLabelActionProps>

export type ConfigBlock = {
  admin?: {
    disableBlockName?: unknown
  }
  fields: ClientField[]
  labels?: {
    singular?: string
  }
  slug?: string
}

export type ResolvedBlock = ClientBlock | ConfigBlock

export type BlockLabelState = {
  block?: ResolvedBlock
  path: string
  readOnly: boolean
  resolvedRowNumber: number
  rowLabel: string
}

export const useBlockLabelState = (props: BlockLabelActionProps): BlockLabelState => {
  const { field, readOnly } = props

  const { config } = useConfig()
  const { i18n } = useTranslation()
  const { data, path, rowNumber } = useRowLabel<{ blockName?: string; blockType?: string }>()

  const blockType = data?.blockType
  const resolvedRowNumber =
    typeof rowNumber === 'number'
      ? rowNumber + 1
      : Number.parseInt(path.split('.').at(-1) ?? '', 10) + 1

  const blocksMap = config.blocksMap as Record<string, ConfigBlock> | undefined
  const block =
    field.blocks?.find((candidate) => candidate.slug === blockType) ??
    field.blockReferences?.find(
      (candidate): candidate is ClientBlock =>
        typeof candidate !== 'string' && candidate.slug === blockType,
    ) ??
    (blockType ? blocksMap?.[blockType] : undefined)
  const blockSlug = block?.slug ?? blockType
  const rowLabel = getTranslation(block?.labels?.singular ?? blockSlug ?? 'Block', i18n)

  return {
    block,
    path,
    readOnly: Boolean(readOnly),
    resolvedRowNumber,
    rowLabel,
  }
}

'use client'

import type { ClientBlock, ClientField, SanitizedFieldPermissions } from 'payload'

import { getTranslation } from '@payloadcms/translations'
import {
  Drawer,
  DrawerToggler,
  GroupField,
  Pill,
  SectionTitle,
  useConfig,
  useRowLabel,
  useTranslation,
} from '@payloadcms/ui'
import React, { useMemo } from 'react'

import { blockSettingsFieldMatches } from '../shared.js'
import type { BlockSettingsLabelClientProps } from '../types.js'
import './BlockSettingsLabel.scss'

const baseClass = 'payload-block-settings'

const SettingsIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

type BlockSettingsLabelProps = BlockSettingsLabelClientProps & {
  readonly field: ClientField & {
    readonly blockReferences?: (ClientBlock | string)[]
    readonly blocks?: ClientBlock[]
    readonly name: string
  }
  readonly permissions?: SanitizedFieldPermissions
  readonly readOnly?: boolean
  readonly schemaPath?: string
}

type ConfigBlock = {
  admin?: {
    disableBlockName?: boolean
  }
  fields: ClientField[]
  labels?: {
    singular?: string
  }
  slug?: string
}

const getBlockPermissions = (
  permissions: SanitizedFieldPermissions | undefined,
  blockSlug: string,
): RenderFieldsPermissions => {
  if (!permissions || permissions === true) {
    return true
  }

  const blockPermissionsMap = permissions.blocks as
    | Record<string, SanitizedFieldPermissions | undefined>
    | undefined
  const permissionsBlockSpecific = blockPermissionsMap?.[blockSlug] ?? permissions.blocks

  if (permissionsBlockSpecific === true) {
    return true
  }

  if (permissionsBlockSpecific?.fields) {
    return permissionsBlockSpecific.fields as RenderFieldsPermissions
  }

  if (typeof permissions === 'object' && permissions && !permissionsBlockSpecific) {
    const hasReadPermission = permissions.read === true
    const missingCreateOrUpdate = !permissions.create || !permissions.update
    const hasRestrictiveStructure =
      hasReadPermission &&
      (missingCreateOrUpdate || (Object.keys(permissions).length === 1 && permissions.read))

    if (hasRestrictiveStructure) {
      return { read: true }
    }
  }

  return true
}

type RenderFieldsPermissions =
  | {
      [fieldName: string]: SanitizedFieldPermissions
    }
  | SanitizedFieldPermissions

const getSettingsGroupPermissions = ({
  blockPermissions,
  settingsFieldName,
}: {
  blockPermissions: RenderFieldsPermissions
  settingsFieldName: string
}): SanitizedFieldPermissions => {
  if (blockPermissions === true) {
    return true
  }

  const groupPermission = (
    blockPermissions as Record<string, SanitizedFieldPermissions | undefined>
  )?.[settingsFieldName]

  if (groupPermission === true) {
    return true
  }

  if (groupPermission && typeof groupPermission === 'object') {
    return groupPermission
  }

  return true
}

export const BlockSettingsLabel: React.FC<BlockSettingsLabelProps> = (props) => {
  const { field, permissions, readOnly, schemaPath } = props

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
  const settingsField = block?.fields.find((candidate: ClientField) =>
    blockSettingsFieldMatches(candidate),
  )
  const settingsFields = settingsField?.fields ?? []
  const resolvedSettingsFieldName = settingsField?.name

  const hasSettings = Boolean(settingsField && resolvedSettingsFieldName && settingsFields.length > 0)
  const blockSlug = block?.slug ?? blockType
  const rowLabel = getTranslation(block?.labels?.singular ?? blockSlug ?? 'Block', i18n)
  const drawerSlug = `${path}__${resolvedSettingsFieldName}__drawer`
  const blockSchemaPath = blockSlug ? `${schemaPath ?? field.name}${blockSlug}` : undefined
  const settingsSchemaPath = blockSchemaPath
    ? `${blockSchemaPath}.${resolvedSettingsFieldName}`
    : `${field.name}.${resolvedSettingsFieldName}`
  const settingsPath = `${path}.${resolvedSettingsFieldName}`
  const blockPermissions = blockSlug ? getBlockPermissions(permissions, blockSlug) : true
  const settingsPermissions = resolvedSettingsFieldName
    ? getSettingsGroupPermissions({
        blockPermissions,
        settingsFieldName: resolvedSettingsFieldName,
      })
    : true

  const settingsTitle = useMemo(() => `${rowLabel} Settings`, [rowLabel])

  return (
    <div className={baseClass}>
      <div className={`${baseClass}__header`}>
        <span className={`${baseClass}__number`}>{String(resolvedRowNumber).padStart(2, '0')}</span>
        <Pill className={`${baseClass}__pill`} pillStyle="white" size="small">
          {rowLabel}
        </Pill>
        {!block?.admin?.disableBlockName && (
          <SectionTitle path={`${path}.blockName`} readOnly={Boolean(readOnly)} />
        )}
      </div>
      {hasSettings && settingsField && resolvedSettingsFieldName && (
        <React.Fragment>
          <DrawerToggler
            aria-label={settingsTitle}
            className={`${baseClass}__button`}
            slug={drawerSlug}
          >
            <SettingsIcon />
          </DrawerToggler>
          <Drawer slug={drawerSlug} title={settingsTitle}>
            <GroupField
              field={settingsField}
              parentPath={settingsPath}
              path={settingsPath}
              permissions={settingsPermissions}
              readOnly={Boolean(readOnly)}
              schemaPath={settingsSchemaPath}
            />
          </Drawer>
        </React.Fragment>
      )}
    </div>
  )
}

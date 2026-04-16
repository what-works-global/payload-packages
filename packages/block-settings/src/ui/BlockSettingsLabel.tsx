'use client'

import type { ClientField, SanitizedFieldPermissions } from 'payload'

import { getTranslation } from '@payloadcms/translations'
import {
  Drawer,
  DrawerToggler,
  Pill,
  RenderFields,
  SectionTitle,
  useConfig,
  useRowLabel,
  useTranslation,
} from '@payloadcms/ui'
import React, { useMemo } from 'react'

import { blockSettingsFieldMatches, DEFAULT_BLOCK_SETTINGS_FIELD_NAME } from '../shared.js'
import type { BlockSettingsLabelClientProps } from '../types.js'
import './BlockSettingsLabel.scss'

const baseClass = 'payload-block-settings'

const SettingsIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="20"
    viewBox="0 0 20 20"
    width="20"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9.33337 8.84671L6.66671 4.22671M9.33337 11.1534L6.66671 15.7734M10 16.6667V15.3334M10 15.3334C12.9456 15.3334 15.3334 12.9456 15.3334 10C15.3334 7.05452 12.9456 4.66671 10 4.66671M10 15.3334C7.05452 15.3334 4.66671 12.9456 4.66671 10M10 3.33337V4.66671M10 4.66671C7.05452 4.66671 4.66671 7.05452 4.66671 10M11.3334 10H16.6667M11.3334 10C11.3334 10.7364 10.7364 11.3334 10 11.3334C9.26366 11.3334 8.66671 10.7364 8.66671 10C8.66671 9.26366 9.26366 8.66671 10 8.66671C10.7364 8.66671 11.3334 9.26366 11.3334 10ZM13.3334 15.7734L12.6667 14.62M13.3334 4.22671L12.6667 5.38004M3.33337 10H4.66671M15.7734 13.3334L14.62 12.6667M15.7734 6.66671L14.62 7.33337M4.22671 13.3334L5.38004 12.6667M4.22671 6.66671L5.38004 7.33337"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

type BlockSettingsLabelProps = BlockSettingsLabelClientProps & {
  readonly blockType: string
  readonly field: ClientField & { name: string }
  readonly permissions?: SanitizedFieldPermissions
  readonly readOnly?: boolean
  readonly rowNumber: number
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
      (missingCreateOrUpdate ||
        (Object.keys(permissions).length === 1 && permissions.read))

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

const getSettingsPermissions = ({
  blockPermissions,
  settingsFieldName,
}: {
  blockPermissions: RenderFieldsPermissions
  settingsFieldName: string
}): RenderFieldsPermissions => {
  if (blockPermissions === true) {
    return true
  }

  const groupPermission = (
    blockPermissions as Record<string, SanitizedFieldPermissions | undefined>
  )?.[settingsFieldName]

  if (groupPermission === true) {
    return true
  }

  if (groupPermission && typeof groupPermission === 'object' && 'fields' in groupPermission) {
    return (groupPermission.fields ?? true) as RenderFieldsPermissions
  }

  return true
}

export const BlockSettingsLabel: React.FC<BlockSettingsLabelProps> = (props) => {
  const {
    blockType,
    field,
    permissions,
    readOnly,
    rowNumber,
    settingsFieldName = DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
    schemaPath,
  } = props

  const { config } = useConfig()
  const { i18n } = useTranslation()
  const { path } = useRowLabel<{ blockName?: string }>()

  const blocksMap = config.blocksMap as Record<string, ConfigBlock> | undefined
  const block = blocksMap?.[blockType]
  const settingsField = block?.fields.find((candidate: ClientField) =>
    blockSettingsFieldMatches(candidate, settingsFieldName),
  )
  const settingsFields = settingsField?.fields ?? []

  const hasSettings = settingsFields.length > 0
  const rowLabel = getTranslation(block?.labels?.singular ?? blockType, i18n)
  const drawerSlug = `${path}__${settingsFieldName}__drawer`
  const blockSchemaPath = `${schemaPath ?? field.name}${blockType}`
  const blockPermissions = getBlockPermissions(permissions, blockType)
  const settingsPermissions = getSettingsPermissions({
    blockPermissions,
    settingsFieldName,
  })

  const settingsTitle = useMemo(() => `${rowLabel} Settings`, [rowLabel])

  return (
    <div className={baseClass}>
      <div className={`${baseClass}__header`}>
        <span className={`${baseClass}__number`}>{String(rowNumber).padStart(2, '0')}</span>
        <Pill className={`${baseClass}__pill`} pillStyle="white" size="small">
          {rowLabel}
        </Pill>
        {!block?.admin?.disableBlockName && (
          <SectionTitle path={`${path}.blockName`} readOnly={Boolean(readOnly)} />
        )}
      </div>
      {hasSettings && (
        <React.Fragment>
          <DrawerToggler
            aria-label={settingsTitle}
            className={`${baseClass}__button`}
            slug={drawerSlug}
          >
            <SettingsIcon />
          </DrawerToggler>
          <Drawer slug={drawerSlug} title={settingsTitle}>
            <RenderFields
              fields={settingsFields}
              margins="small"
              parentIndexPath=""
              parentPath={`${path}.${settingsFieldName}`}
              parentSchemaPath={`${blockSchemaPath}.${settingsFieldName}`}
              permissions={settingsPermissions}
              readOnly={Boolean(readOnly)}
            />
          </Drawer>
        </React.Fragment>
      )}
    </div>
  )
}

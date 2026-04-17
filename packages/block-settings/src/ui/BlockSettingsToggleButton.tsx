'use client'

import type { ClientField, SanitizedFieldPermissions } from 'payload'

import { Drawer, GroupField } from '@payloadcms/ui'
import { useModal } from '@payloadcms/ui'
import React, { useMemo } from 'react'

import {
  blockSettingsFieldMatches,
  getBlockSettingsFieldLocation,
  getBlockSettingsToggleSlug,
} from '../shared.js'
import { toggleInlineSettings, useInlineSettingsOpen } from './inlineSettingsStore.js'
import type { BlockLabelActionProps } from './useBlockLabelState.js'
import { useBlockLabelState } from './useBlockLabelState.js'
import './BlockSettingsToggleButton.scss'

type RenderFieldsPermissions =
  | {
      [fieldName: string]: SanitizedFieldPermissions
    }
  | SanitizedFieldPermissions

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

const SettingsIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const BlockSettingsToggleButton: React.FC<BlockLabelActionProps> = (props) => {
  const { field, permissions, schemaPath } = props
  const { block, path, readOnly, rowLabel } = useBlockLabelState(props)
  const { modalState, openModal } = useModal()

  const settingsField = block?.fields.find((candidate: ClientField) =>
    blockSettingsFieldMatches(candidate),
  ) as
    | (ClientField & {
        fields: ClientField[]
        name: string
        type: 'group'
      })
    | undefined
  const settingsLocation = settingsField ? getBlockSettingsFieldLocation(settingsField) : 'drawer'
  const settingsFieldName = settingsField?.name
  const settingsPath = `${path}.${settingsFieldName}`
  const settingsToggleSlug = getBlockSettingsToggleSlug(settingsPath)
  const blockSlug = block?.slug
  const blockPermissions = blockSlug ? getBlockPermissions(permissions, blockSlug) : true
  const settingsPermissions = settingsFieldName
    ? getSettingsGroupPermissions({
        blockPermissions,
        settingsFieldName,
      })
    : true
  const settingsSchemaPath = useMemo(() => {
    if (!settingsFieldName) {
      return field.name
    }

    const blockSchemaPath = blockSlug ? `${schemaPath ?? field.name}${blockSlug}` : undefined

    return blockSchemaPath
      ? `${blockSchemaPath}.${settingsFieldName}`
      : `${field.name}.${settingsFieldName}`
  }, [blockSlug, field.name, schemaPath, settingsFieldName])
  const isInlineSettingsVisible = useInlineSettingsOpen(settingsPath)
  const areSettingsVisible =
    settingsLocation === 'inline'
      ? isInlineSettingsVisible
      : modalState[settingsToggleSlug]?.isOpen === true
  const settingsTitle = useMemo(() => `${rowLabel} Settings`, [rowLabel])

  if (!settingsField || settingsField.fields.length === 0 || !settingsFieldName) {
    return null
  }

  const toggleSettings = () => {
    if (settingsLocation === 'inline') {
      toggleInlineSettings(settingsPath)
      return
    }

    openModal(settingsToggleSlug)
  }

  const buttonClassName = ['block-label-action', 'block-settings-toggle']

  if (areSettingsVisible) {
    buttonClassName.push('block-settings-toggle--active')
  }

  return (
    <React.Fragment>
      <button
        aria-label={settingsTitle}
        aria-pressed={settingsLocation === 'inline' ? areSettingsVisible : undefined}
        className={buttonClassName.join(' ')}
        onClick={toggleSettings}
        type="button"
      >
        <SettingsIcon />
      </button>
      {settingsLocation === 'drawer' && (
        <Drawer slug={settingsToggleSlug} title={settingsTitle}>
          <GroupField
            field={settingsField}
            parentPath={settingsPath}
            path={settingsPath}
            permissions={settingsPermissions}
            readOnly={readOnly}
            schemaPath={settingsSchemaPath}
          />
        </Drawer>
      )}
    </React.Fragment>
  )
}

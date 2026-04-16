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
  useFormFields,
  useRowLabel,
  useTranslation,
} from '@payloadcms/ui'
import React, { useEffect, useMemo, useRef } from 'react'

import {
  BLOCK_SETTINGS_HIDDEN_CLASS,
  blockSettingsFieldMatches,
  DEFAULT_BLOCK_SETTINGS_FIELD_NAME,
} from '../shared.js'
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

type DebugFieldSnapshot = {
  readonly childStates: Record<
    string,
    | {
        readonly errorMessage?: string
        readonly initialValue?: unknown
        readonly passesCondition?: boolean
        readonly valid?: boolean
        readonly value?: unknown
      }
    | null
  >
  readonly groupPath: string
  readonly groupState:
    | {
        readonly disableFormData?: boolean
        readonly errorMessage?: string
        readonly initialValue?: unknown
        readonly passesCondition?: boolean
        readonly valid?: boolean
        readonly value?: unknown
      }
    | null
  readonly schemaPath: string
}

const BlockSettingsDebug: React.FC<{
  readonly childPaths: string[]
  readonly groupPath: string
  readonly label: string
  readonly schemaPath: string
}> = ({ childPaths, groupPath, label, schemaPath }) => {
  const snapshot = useFormFields(([fields]) => {
    const groupField = fields?.[groupPath]

    return {
      childStates: Object.fromEntries(
        childPaths.map((childPath) => [
          childPath,
          fields?.[childPath]
            ? {
                errorMessage: fields[childPath].errorMessage,
                initialValue: fields[childPath].initialValue,
                passesCondition: fields[childPath].passesCondition,
                valid: fields[childPath].valid,
                value: fields[childPath].value,
              }
            : null,
        ]),
      ),
      groupPath,
      groupState: groupField
        ? {
            disableFormData: groupField.disableFormData,
            errorMessage: groupField.errorMessage,
            initialValue: groupField.initialValue,
            passesCondition: groupField.passesCondition,
            valid: groupField.valid,
            value: groupField.value,
          }
        : null,
      schemaPath,
    } satisfies DebugFieldSnapshot
  })

  const previousSnapshot = useRef<string | null>(null)

  useEffect(() => {
    const serializedSnapshot = JSON.stringify(snapshot)

    if (previousSnapshot.current === serializedSnapshot) {
      return
    }

    previousSnapshot.current = serializedSnapshot

    console.log('[block-settings]', label, snapshot)
  }, [label, snapshot])

  return null
}

export const BlockSettingsLabel: React.FC<BlockSettingsLabelProps> = (props) => {
  const { field, permissions, readOnly, settingsFieldName = DEFAULT_BLOCK_SETTINGS_FIELD_NAME, schemaPath } = props

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
      (candidate): candidate is ClientBlock => typeof candidate !== 'string' && candidate.slug === blockType,
    ) ??
    (blockType ? blocksMap?.[blockType] : undefined)
  const settingsField = block?.fields.find((candidate: ClientField) =>
    blockSettingsFieldMatches(candidate, settingsFieldName),
  )
  const settingsFields = settingsField?.fields ?? []

  const hasSettings = Boolean(settingsField && settingsFields.length > 0)
  const blockSlug = block?.slug ?? blockType
  const rowLabel = getTranslation(block?.labels?.singular ?? blockSlug ?? 'Block', i18n)
  const drawerSlug = `${path}__${settingsFieldName}__drawer`
  const blockSchemaPath = blockSlug ? `${schemaPath ?? field.name}${blockSlug}` : undefined
  const settingsSchemaPath = blockSchemaPath
    ? `${blockSchemaPath}.${settingsFieldName}`
    : `${field.name}.${settingsFieldName}`
  const settingsPath = `${path}.${settingsFieldName}`
  const settingsChildPaths = settingsFields
    .filter((candidate): candidate is ClientField & { name: string } => 'name' in candidate)
    .map((candidate) => `${settingsPath}.${candidate.name}`)
  const blockPermissions = blockSlug ? getBlockPermissions(permissions, blockSlug) : true
  const settingsPermissions = getSettingsGroupPermissions({
    blockPermissions,
    settingsFieldName,
  })
  const settingsFieldForDrawer = settingsField
    ? {
        ...settingsField,
        admin: {
          ...settingsField.admin,
          className:
            settingsField.admin?.className
              ?.split(' ')
              .filter((className) => className && className !== BLOCK_SETTINGS_HIDDEN_CLASS)
              .join(' ') || undefined,
          hideGutter: settingsField.admin?.hideGutter,
        },
      }
    : undefined

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
      {hasSettings && settingsField && settingsFieldForDrawer && (
        <React.Fragment>
          <DrawerToggler
            aria-label={settingsTitle}
            className={`${baseClass}__button`}
            slug={drawerSlug}
          >
            <SettingsIcon />
          </DrawerToggler>
          <Drawer slug={drawerSlug} title={settingsTitle}>
            <BlockSettingsDebug
              childPaths={settingsChildPaths}
              groupPath={settingsPath}
              label={settingsTitle}
              schemaPath={settingsSchemaPath}
            />
            <GroupField
              field={settingsFieldForDrawer}
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

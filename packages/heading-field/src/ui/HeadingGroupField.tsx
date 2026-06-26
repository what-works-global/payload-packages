'use client'

import type { ClientField, GroupFieldClientComponent } from 'payload'

import { getTranslation } from '@payloadcms/translations'
import {
  FieldLabel,
  RenderCustomComponent,
  RenderFields,
  useField,
  useTranslation,
} from '@payloadcms/ui'
import React, { useMemo } from 'react'

import { getHeadingTags, getHeadingTooltip, HEADING_VALUE_FIELD_NAME } from '../shared.js'
import { HeadingTagProvider, HeadingTagSelect } from './HeadingTagSelect.js'
import { HeadingTagTooltip } from './HeadingTagTooltip.js'
import './HeadingGroupField.scss'

const baseClass = 'heading-field'

const toElementId = (path: string): string => path.replace(/\./g, '__')

// `headingField()` always produces a *named* group with `fields`, but the
// client component type is the broader (possibly unnamed) union, so narrow it.
interface HeadingGroupClientField {
  readonly admin?: { readonly custom?: Record<string, unknown> }
  readonly fields: ClientField[]
  readonly label?: false | Record<string, string> | string
  readonly name: string
}

/**
 * Renders a heading field as a single, normal-looking field: the configured
 * value field with a compact heading-tag dropdown sitting inline-flex,
 * justified to the opposite end of the field label.
 *
 * The `tag` sub-field is never passed to `RenderFields` — it is driven directly
 * here via `useField`, while only the `value` sub-field is rendered normally.
 */
export const HeadingGroupField: GroupFieldClientComponent = (props) => {
  const { path, permissions, readOnly, schemaPath: schemaPathFromProps } = props
  const field = props.field as unknown as HeadingGroupClientField

  const schemaPath = schemaPathFromProps ?? field.name
  const { i18n } = useTranslation()

  // The group's own field state carries any consumer-provided custom components
  // (resolved server-side), including a custom `Label` lifted up by headingField().
  const { customComponents } = useField({ path })

  const tags = useMemo(() => getHeadingTags(field), [field])
  const tooltip = useMemo(() => getHeadingTooltip(field), [field])

  const valueFields = useMemo(
    () =>
      (field.fields ?? []).filter(
        (child) => 'name' in child && child.name === HEADING_VALUE_FIELD_NAME,
      ),
    [field.fields],
  )
  const valueField = valueFields[0]

  // `label` is stripped from the client field *type* but is present at runtime
  // (Payload resolves it during client-config creation, as GroupField relies on).
  const labelText = getTranslation(field.label || field.name, i18n)

  const required = Boolean(valueField && 'required' in valueField && valueField.required)
  const localized = Boolean(valueField && 'localized' in valueField && valueField.localized)

  const childPermissions = permissions === true ? true : (permissions?.fields ?? {})
  const selectId = `${toElementId(path)}-heading-tag`
  const valueInputId = `field-${toElementId(`${path}.${HEADING_VALUE_FIELD_NAME}`)}`

  // A custom `Label` replaces the whole header (`RenderCustomComponent` renders
  // it instead of the fallback), so it owns the label *and* the dropdown's
  // placement — it can drop in `<HeadingTagSelect />` wherever it likes. Without
  // one, the fallback renders the default label + dropdown.
  return (
    <div className={`field-type ${baseClass}`} id={`field-${toElementId(path)}`}>
      <HeadingTagProvider value={{ path, readOnly: Boolean(readOnly), tags }}>
        <div className={`${baseClass}__header`}>
          <RenderCustomComponent
            CustomComponent={customComponents?.Label}
            Fallback={
              <>
                <FieldLabel
                  htmlFor={valueInputId}
                  label={labelText}
                  localized={localized}
                  path={path}
                  required={required}
                />
                <HeadingTagTooltip tooltip={tooltip} />
                <HeadingTagSelect id={selectId} />
              </>
            }
          />
        </div>
        <RenderFields
          fields={valueFields}
          margins={false}
          parentIndexPath=""
          parentPath={path}
          parentSchemaPath={schemaPath}
          permissions={childPermissions}
          readOnly={readOnly}
        />
      </HeadingTagProvider>
    </div>
  )
}

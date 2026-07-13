'use client'

import type { SelectFieldClientProps } from 'payload'

import { FieldDescription, FieldLabel, useField, useFormFields } from '@payloadcms/ui'
import React, { useCallback, useMemo } from 'react'

import type { MatrixRow, RbacAction } from '../shared.js'

import { FULL_ACCESS, permissionFor } from '../permissions.js'
import { collectionActions } from '../shared.js'

const cellStyle: React.CSSProperties = {
  border: '1px solid var(--theme-elevation-150)',
  padding: '8px 12px',
  textAlign: 'center',
}

const rowLabelStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'left',
}

export type PermissionsMatrixFieldProps = {
  /** Names of code-locked roles the matrix renders read-only for. */
  protectedRoleNames?: string[]
  /** Serialized by the plugin into the field's `clientProps`. */
  rows?: MatrixRow[]
} & SelectFieldClientProps

const columnWildcard = (action: RbacAction): string => `*:${action}`
const rowWildcard = (slug: string): string => `${slug}:*`

/**
 * Renders the roles collection's `permissions` select as a matrix of collections ×
 * Create/Read/Update/Delete checkboxes (globals: Read/Update), with a "full access"
 * master toggle for `'*'`, an "All collections and globals" row for the
 * `'*:<action>'` wildcards, and cells granted through a wildcard — `'<slug>:*'`
 * or `'*:<action>'` — shown checked and locked. The stored value stays a plain
 * array of permission strings, so the REST/local APIs are unaffected.
 */
export const PermissionsMatrixField: React.FC<PermissionsMatrixFieldProps> = (props) => {
  const { field, path, protectedRoleNames = [], readOnly, rows = [] } = props
  const { setValue, showError, value } = useField<string[]>({ path })
  const roleName = useFormFields(([fields]) => fields?.name?.value)

  const selected = useMemo(() => new Set(value ?? []), [value])
  const fullAccess = selected.has(FULL_ACCESS)
  // Best-effort UX only — the beforeChange guard on the server is authoritative.
  const isProtected = typeof roleName === 'string' && protectedRoleNames.includes(roleName)
  const locked = Boolean(readOnly) || isProtected

  const toggle = useCallback(
    (permission: string) => {
      const next = new Set(selected)
      if (next.has(permission)) {
        next.delete(permission)
      } else {
        next.add(permission)
      }
      setValue(Array.from(next).sort())
    },
    [selected, setValue],
  )

  const toggleRow = useCallback(
    (row: MatrixRow) => {
      const allSelected = row.actions.every(
        (action) =>
          selected.has(rowWildcard(row.slug)) ||
          selected.has(columnWildcard(action)) ||
          selected.has(permissionFor(row.slug, action)),
      )
      const next = new Set(selected)
      for (const action of row.actions) {
        if (allSelected) {
          next.delete(permissionFor(row.slug, action))
        } else {
          next.add(permissionFor(row.slug, action))
        }
      }
      if (allSelected) {
        next.delete(rowWildcard(row.slug))
      }
      setValue(Array.from(next).sort())
    },
    [selected, setValue],
  )

  const hasGlobals = rows.some((row) => row.entity === 'global')
  const hasCollections = rows.some((row) => row.entity === 'collection')

  const renderRows = (entity: MatrixRow['entity']) =>
    rows
      .filter((row) => row.entity === entity)
      .map((row) => {
        const hasRowWildcard = selected.has(rowWildcard(row.slug))
        const actionChecked = (action: RbacAction) =>
          hasRowWildcard ||
          selected.has(columnWildcard(action)) ||
          selected.has(permissionFor(row.slug, action))
        const allChecked = fullAccess || row.actions.every(actionChecked)
        const someChecked = row.actions.some(actionChecked)
        return (
          <tr key={`${row.entity}:${row.slug}`}>
            <td style={rowLabelStyle}>{row.label}</td>
            <td style={cellStyle}>
              <input
                aria-label={`${row.label}: all actions`}
                checked={allChecked}
                disabled={locked || fullAccess}
                onChange={() => toggleRow(row)}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = !allChecked && someChecked
                  }
                }}
                type="checkbox"
              />
            </td>
            {collectionActions.map((action: RbacAction) => {
              const available = row.actions.includes(action)
              const permission = permissionFor(row.slug, action)
              const wildcarded = hasRowWildcard || selected.has(columnWildcard(action))
              return (
                <td key={action} style={cellStyle}>
                  {available ? (
                    <input
                      aria-label={`${row.label}: ${action}`}
                      checked={fullAccess || wildcarded || selected.has(permission)}
                      disabled={locked || fullAccess || wildcarded}
                      onChange={() => toggle(permission)}
                      type="checkbox"
                    />
                  ) : (
                    <span aria-hidden>—</span>
                  )}
                </td>
              )
            })}
          </tr>
        )
      })

  const sectionHeading = (label: string) => (
    <tr>
      <th colSpan={collectionActions.length + 2} style={{ ...rowLabelStyle, fontWeight: 600 }}>
        {label}
      </th>
    </tr>
  )

  return (
    <div className="field-type rbac-permissions-matrix" style={{ marginBottom: 'var(--base)' }}>
      <FieldLabel label={field?.label ?? 'Permissions'} path={path} />
      {showError && (
        <div style={{ color: 'var(--theme-error-500)', marginBottom: 8 }}>
          Invalid permissions value
        </div>
      )}
      {isProtected && (
        <div style={{ color: 'var(--theme-elevation-500)', margin: '8px 0' }}>
          This role is protected — its permissions are defined in code and cannot be edited here.
        </div>
      )}
      <label style={{ alignItems: 'center', display: 'flex', gap: 8, margin: '8px 0 12px' }}>
        <input
          aria-label="Full access"
          checked={fullAccess}
          disabled={locked}
          onChange={() => toggle(FULL_ACCESS)}
          type="checkbox"
        />
        <span>
          Full access — every action on every collection and global, including ones added in the
          future
        </span>
      </label>
      <div style={{ opacity: fullAccess ? 0.5 : 1, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th aria-label="Collection or global" style={rowLabelStyle} />
              <th style={cellStyle}>All</th>
              {collectionActions.map((action) => (
                <th key={action} style={{ ...cellStyle, textTransform: 'capitalize' }}>
                  {action}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {/* The `'*:<action>'` wildcards: one action on every collection and
                  global, present and future. Create/delete only ever match
                  collections — globals have no such actions. */}
              <td style={rowLabelStyle}>Everything</td>
              <td style={cellStyle}>
                <span aria-hidden>—</span>
              </td>
              {collectionActions.map((action) => (
                <td key={action} style={cellStyle}>
                  <input
                    aria-label={`Everything: ${action}`}
                    checked={fullAccess || selected.has(columnWildcard(action))}
                    disabled={locked || fullAccess}
                    onChange={() => toggle(columnWildcard(action))}
                    type="checkbox"
                  />
                </td>
              ))}
            </tr>
            {hasCollections && hasGlobals && sectionHeading('Collections')}
            {renderRows('collection')}
            {hasGlobals && sectionHeading('Globals')}
            {renderRows('global')}
          </tbody>
        </table>
      </div>
      <FieldDescription
        description={field?.admin?.description}
        marginPlacement="bottom"
        path={path}
      />
    </div>
  )
}

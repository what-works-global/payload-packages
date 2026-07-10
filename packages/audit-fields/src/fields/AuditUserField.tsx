import type { RelationshipFieldServerProps } from 'payload'

import { FieldLabel, Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import { defaultResolveUserLabel } from '../defaults.js'
import { getAuditFieldsCustomConfig } from '../shared.js'
import { normalizeUserRef } from '../utilities/normalizeUserRef.js'

/**
 * Read-only display for an audit field, replacing the default relationship input.
 * Resolves the attributed user's label through the plugin's `resolveUserLabel`
 * (default: email → username → ID) and links to the user document. Falls back to
 * the raw ID when the viewing user cannot read the referenced document.
 */
export async function AuditUserField(props: RelationshipFieldServerProps) {
  const { clientField, path, req } = props

  const auditConfig = getAuditFieldsCustomConfig(req.payload.config)
  const resolveUserLabel = auditConfig?.resolveUserLabel ?? defaultResolveUserLabel
  const ref = normalizeUserRef(props.value, auditConfig?.userCollections[0])

  let label: null | string = null
  let linked = false

  if (ref) {
    label = String(ref.value)
    try {
      const result = await req.payload.find({
        collection: ref.relationTo,
        depth: 0,
        limit: 1,
        overrideAccess: false,
        pagination: false,
        req,
        user: req.user,
        where: { id: { equals: ref.value } },
      })
      const userDoc = result.docs[0] as Record<string, unknown> | undefined
      if (userDoc) {
        linked = true
        const resolved = await resolveUserLabel({ relationTo: ref.relationTo, req, user: userDoc })
        if (resolved) {
          label = resolved
        }
      }
    } catch {
      // The viewing user may not be allowed to read the user collection — show the
      // raw ID without a link.
    }
  }

  return (
    <div className="field-type audit-user-field">
      <FieldLabel label={clientField.label} path={path} />
      <div className="audit-user-field__value">
        {ref && label ? (
          linked ? (
            <Link
              href={formatAdminURL({
                adminRoute: req.payload.config.routes.admin,
                path: `/collections/${ref.relationTo}/${String(ref.value)}`,
              })}
              prefetch={false}
            >
              {label}
            </Link>
          ) : (
            label
          )
        ) : (
          '—'
        )}
      </div>
    </div>
  )
}

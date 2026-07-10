import type { RelationshipFieldServerProps } from 'payload'

import { FieldLabel, Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import { getLoggedDocumentStatus } from '../cells/getLoggedDocumentStatus.js'
import { normalizeUserRef } from '../utilities/normalizeUserRef.js'

/**
 * Read-only display for the log entry's `user` field, replacing the default
 * relationship input. Renders the label captured at event time (sibling
 * `userLabel` field), linked to the user document while it still exists —
 * deleted users keep their label but lose the link, and users sitting in the
 * trash link to the trash route.
 */
export async function ActivityUserField(props: RelationshipFieldServerProps) {
  const { clientField, data, path, req } = props

  const ref = normalizeUserRef(props.value)
  const storedLabel = typeof data?.userLabel === 'string' ? data.userLabel : ''
  const label = storedLabel || (ref ? String(ref.value) : '')

  let href: null | string = null
  if (label && ref && req.payload.collections[ref.relationTo]) {
    const status = await getLoggedDocumentStatus(req.payload, ref.relationTo, String(ref.value))
    if (status !== 'missing') {
      // A user sitting in the trash lives under the trash route until restored.
      const basePath: `/${string}` =
        status === 'trashed'
          ? `/collections/${ref.relationTo}/trash`
          : `/collections/${ref.relationTo}`
      href = formatAdminURL({
        adminRoute: req.payload.config.routes.admin,
        path: `${basePath}/${encodeURIComponent(String(ref.value))}`,
      })
    }
  }

  return (
    <div className="field-type activity-user-field">
      <FieldLabel label={clientField.label} path={path} />
      <div className="activity-user-field__value">
        {label ? (
          href ? (
            <Link href={href} prefetch={false}>
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

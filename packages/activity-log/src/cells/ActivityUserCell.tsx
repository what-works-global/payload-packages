import type { DefaultServerCellComponentProps } from 'payload'

import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import { normalizeUserRef } from '../utilities/normalizeUserRef.js'
import { getLoggedDocumentStatus } from './getLoggedDocumentStatus.js'

/**
 * List cell for the `user` field. Renders the label captured at event time,
 * linked to the user document while it still exists — deleted users keep their
 * label but lose the link, and users sitting in the trash link to the trash
 * route.
 */
export async function ActivityUserCell(props: DefaultServerCellComponentProps) {
  const { cellData, payload, rowData } = props

  const ref = normalizeUserRef(cellData)
  const storedLabel = typeof rowData.userLabel === 'string' ? rowData.userLabel : ''
  const label = storedLabel || (ref ? String(ref.value) : '')

  if (!label) {
    return <span>—</span>
  }

  if (ref && payload.collections[ref.relationTo]) {
    const status = await getLoggedDocumentStatus(payload, ref.relationTo, String(ref.value))
    if (status !== 'missing') {
      // A user sitting in the trash lives under the trash route until restored.
      const basePath: `/${string}` =
        status === 'trashed'
          ? `/collections/${ref.relationTo}/trash`
          : `/collections/${ref.relationTo}`
      return (
        <Link
          href={formatAdminURL({
            adminRoute: payload.config.routes.admin,
            path: `${basePath}/${encodeURIComponent(String(ref.value))}`,
          })}
          prefetch={false}
        >
          {label}
        </Link>
      )
    }
  }

  return <span>{label}</span>
}

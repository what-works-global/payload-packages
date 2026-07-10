import type { DefaultServerCellComponentProps } from 'payload'

import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import { getLoggedDocumentStatus } from './getLoggedDocumentStatus.js'

/**
 * List cell for the `documentTitle` field. Renders the title captured at event
 * time, linked to the affected document while it still exists — deleted
 * documents keep their title but lose the link, and documents sitting in the
 * trash link to the trash route.
 */
export async function ActivityDocumentCell(props: DefaultServerCellComponentProps) {
  const { cellData, payload, rowData } = props

  const collectionSlug = typeof rowData.collectionSlug === 'string' ? rowData.collectionSlug : ''
  const globalSlug = typeof rowData.globalSlug === 'string' ? rowData.globalSlug : ''
  const documentId = typeof rowData.documentId === 'string' ? rowData.documentId : ''

  const title = (typeof cellData === 'string' && cellData) || documentId || globalSlug || ''

  if (!title) {
    return <span>—</span>
  }

  const adminRoute = payload.config.routes.admin
  let href: null | string = null

  if (globalSlug && payload.globals.config.some((global) => global.slug === globalSlug)) {
    href = formatAdminURL({ adminRoute, path: `/globals/${globalSlug}` })
  } else if (collectionSlug && documentId && payload.collections[collectionSlug]) {
    const status = await getLoggedDocumentStatus(payload, collectionSlug, documentId)
    if (status === 'live' || status === 'trashed' || status === 'unknown') {
      // A document sitting in the trash lives under the trash route until
      // restored. On 'unknown' (status query failed) fall back to the row's own
      // operation as the best guess.
      const trashed =
        status === 'trashed' || (status === 'unknown' && rowData.operation === 'trash')
      const basePath: `/${string}` = trashed
        ? `/collections/${collectionSlug}/trash`
        : `/collections/${collectionSlug}`
      href = formatAdminURL({
        adminRoute,
        path: `${basePath}/${encodeURIComponent(documentId)}`,
      })
    }
  }

  if (href) {
    return (
      <Link href={href} prefetch={false}>
        {title}
      </Link>
    )
  }

  return <span>{title}</span>
}

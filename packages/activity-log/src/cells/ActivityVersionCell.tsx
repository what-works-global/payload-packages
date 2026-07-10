import type { DefaultServerCellComponentProps } from 'payload'

import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import { getLoggedDocumentStatus, loggedVersionExists } from './getLoggedDocumentStatus.js'

/**
 * `--theme-elevation-400` reads as light gray on the light theme and dims
 * toward the background on the dark theme — Payload uses it for its own
 * secondary text.
 */
const mutedStyle: React.CSSProperties = { color: 'var(--theme-elevation-400)' }

/**
 * List cell for the `versionId` field. Links to the version diff view of the
 * version this change produced. Once the document has been permanently deleted
 * (its versions are deleted with it) the cell shows a muted "Document deleted"
 * instead of a dead link; a version pruned by `versions.maxPerDoc` shows `—`.
 * Documents sitting in the trash link to the version under the trash route.
 */
export async function ActivityVersionCell(props: DefaultServerCellComponentProps) {
  const { cellData, payload, rowData } = props

  const versionId = typeof cellData === 'string' && cellData ? cellData : null
  if (!versionId) {
    return <span>—</span>
  }

  const collectionSlug = typeof rowData.collectionSlug === 'string' ? rowData.collectionSlug : ''
  const globalSlug = typeof rowData.globalSlug === 'string' ? rowData.globalSlug : ''
  const documentId = typeof rowData.documentId === 'string' ? rowData.documentId : ''

  const adminRoute = payload.config.routes.admin
  let href: null | string = null

  if (globalSlug && payload.globals.config.some((global) => global.slug === globalSlug)) {
    if (!(await loggedVersionExists(payload, { globalSlug }, versionId))) {
      return <span>—</span>
    }
    href = formatAdminURL({
      adminRoute,
      path: `/globals/${globalSlug}/versions/${encodeURIComponent(versionId)}`,
    })
  } else if (collectionSlug && documentId && payload.collections[collectionSlug]) {
    const status = await getLoggedDocumentStatus(payload, collectionSlug, documentId)
    if (status === 'missing') {
      return <span style={mutedStyle}>Document deleted</span>
    }
    if (!(await loggedVersionExists(payload, { collectionSlug }, versionId))) {
      return <span>—</span>
    }
    // A document sitting in the trash serves its versions under the trash route.
    const basePath: `/${string}` =
      status === 'trashed'
        ? `/collections/${collectionSlug}/trash`
        : `/collections/${collectionSlug}`
    href = formatAdminURL({
      adminRoute,
      path: `${basePath}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`,
    })
  }

  if (href) {
    return (
      <Link href={href} prefetch={false}>
        View version
      </Link>
    )
  }

  return <span>—</span>
}

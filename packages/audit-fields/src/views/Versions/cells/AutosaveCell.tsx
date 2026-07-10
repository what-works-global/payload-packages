'use client'
// Vendored from payload@3.84.1
// `packages/next/src/views/Versions/cells/AutosaveCell/index.tsx` (MIT).
// The `.autosave-cell` styles ship with the default view, which stays in the admin
// bundle even when overridden, so no stylesheet is imported here.
import type { TypeWithVersion } from 'payload'

import { Pill, useTranslation } from '@payloadcms/ui'
import React from 'react'

import { VersionPillLabel } from '../VersionPillLabel/VersionPillLabel.js'

const baseClass = 'autosave-cell'

type AutosaveCellProps = {
  currentlyPublishedVersion?: TypeWithVersion<any>
  latestDraftVersion?: TypeWithVersion<any>
  rowData: {
    autosave?: boolean
    id: number | string
    publishedLocale?: string
    updatedAt?: string
    version: {
      [key: string]: unknown
      _status: 'draft' | 'published'
      updatedAt: string
    }
  }
}

export const AutosaveCell: React.FC<AutosaveCellProps> = ({
  currentlyPublishedVersion,
  latestDraftVersion,
  rowData,
}) => {
  const { t } = useTranslation()

  return (
    <div className={`${baseClass}__items`}>
      {rowData?.autosave && <Pill size="small">{t('version:autosave')}</Pill>}
      <VersionPillLabel
        currentlyPublishedVersion={currentlyPublishedVersion}
        disableDate={true}
        doc={rowData}
        labelFirst={false}
        labelStyle="pill"
        latestDraftVersion={latestDraftVersion}
      />
    </div>
  )
}

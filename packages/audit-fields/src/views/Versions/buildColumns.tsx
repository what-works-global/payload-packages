// Vendored from payload@3.84.1 `packages/next/src/views/Versions/buildColumns.tsx`
// (MIT), extended with an optional "Modified By" column rendered after the date.
import type { I18n } from '@payloadcms/translations'
import type {
  Column,
  PaginatedDocs,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
  TypeWithVersion,
} from 'payload'

import { SortColumn } from '@payloadcms/ui'
import React from 'react'

import { AutosaveCell } from './cells/AutosaveCell.js'
import { CreatedAtCell, type CreatedAtCellProps } from './cells/CreatedAtCell.js'
import { IDCell } from './cells/IDCell.js'

export const buildVersionColumns = ({
  collectionConfig,
  CreatedAtCellOverride,
  currentlyPublishedVersion,
  docID,
  docs,
  globalConfig,
  i18n: { t },
  isTrashed,
  latestDraftVersion,
  modifiedByColumn,
}: {
  collectionConfig?: SanitizedCollectionConfig
  CreatedAtCellOverride?: React.ComponentType<CreatedAtCellProps>
  currentlyPublishedVersion?: TypeWithVersion<any>
  docID?: number | string
  docs: PaginatedDocs<TypeWithVersion<any>>['docs']
  globalConfig?: SanitizedGlobalConfig
  i18n: I18n
  isTrashed?: boolean
  latestDraftVersion?: TypeWithVersion<any>
  modifiedByColumn?: Column | null
}): Column[] => {
  const entityConfig = collectionConfig || globalConfig

  const CreatedAtCellComponent = CreatedAtCellOverride ?? CreatedAtCell

  const columns: Column[] = [
    {
      accessor: 'updatedAt',
      active: true,
      field: {
        name: '',
        type: 'date',
      },
      Heading: <SortColumn Label={t('general:updatedAt')} name="updatedAt" />,
      renderedCells: docs.map((doc, i) => {
        return (
          <CreatedAtCellComponent
            collectionSlug={collectionConfig?.slug}
            docID={docID}
            globalSlug={globalConfig?.slug}
            isTrashed={isTrashed}
            key={i}
            rowData={{
              id: doc.id,
              updatedAt: doc.updatedAt,
            }}
          />
        )
      }),
    },
    {
      accessor: 'id',
      active: true,
      field: {
        name: '',
        type: 'text',
      },
      Heading: <SortColumn disable Label={t('version:versionID')} name="id" />,
      renderedCells: docs.map((doc, i) => {
        return <IDCell id={doc.id} key={i} />
      }),
    },
  ]

  if (modifiedByColumn) {
    columns.splice(1, 0, modifiedByColumn)
  }

  if (entityConfig?.versions?.drafts) {
    columns.push({
      accessor: '_status',
      active: true,
      field: {
        name: '',
        type: 'checkbox',
      },
      Heading: <SortColumn disable Label={t('version:status')} name="status" />,
      renderedCells: docs.map((doc, i) => {
        return (
          <AutosaveCell
            currentlyPublishedVersion={currentlyPublishedVersion}
            key={i}
            latestDraftVersion={latestDraftVersion}
            rowData={doc}
          />
        )
      }),
    })
  }

  return columns
}

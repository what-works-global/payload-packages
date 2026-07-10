'use client'
// Vendored from payload@3.84.1 `packages/next/src/views/Versions/index.client.tsx` (MIT).
import type { Column } from 'payload'

import {
  LoadingOverlayToggle,
  Pagination,
  PerPage,
  Table,
  useListQuery,
  useTranslation,
} from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation.js'
import { collectionDefaults } from 'payload/shared'
import React from 'react'

// Matches Payload's `collectionDefaults.admin.pagination.limits`, which is typed as
// optional even though it is always populated.
const defaultPaginationLimits = collectionDefaults.admin?.pagination?.limits ?? [5, 10, 25, 50, 100]

export const VersionsViewClient: React.FC<{
  readonly baseClass: string
  readonly columns: Column[]
  readonly fetchURL: string
  readonly paginationLimits?: number[]
}> = (props) => {
  const { baseClass, columns, paginationLimits } = props

  const { data, handlePageChange, handlePerPageChange } = useListQuery()

  const searchParams = useSearchParams()
  const limit = searchParams.get('limit')

  const { i18n } = useTranslation()

  const versionCount = data?.totalDocs || 0

  return (
    <React.Fragment>
      <LoadingOverlayToggle name="versions" show={!data} />
      {versionCount === 0 && (
        <div className={`${baseClass}__no-versions`}>
          {i18n.t('version:noFurtherVersionsFound')}
        </div>
      )}
      {versionCount > 0 && data && (
        <React.Fragment>
          <Table columns={columns} data={data.docs ?? []} />
          <div className={`${baseClass}__page-controls`}>
            <Pagination
              hasNextPage={data.hasNextPage}
              hasPrevPage={data.hasPrevPage}
              limit={data.limit}
              nextPage={data.nextPage ?? undefined}
              numberOfNeighbors={1}
              onChange={handlePageChange}
              page={data.page}
              prevPage={data.prevPage ?? undefined}
              totalPages={data.totalPages}
            />
            {data.totalDocs > 0 && (
              <React.Fragment>
                <div className={`${baseClass}__page-info`}>
                  {(data.page ?? 1) * data.limit - (data.limit - 1)}-
                  {data.totalPages > 1 && data.totalPages !== data.page
                    ? data.limit * (data.page ?? 1)
                    : data.totalDocs}{' '}
                  {i18n.t('general:of')} {data.totalDocs}
                </div>
                <PerPage
                  handleChange={handlePerPageChange}
                  limit={limit ? Number(limit) : 10}
                  limits={paginationLimits ?? defaultPaginationLimits}
                />
              </React.Fragment>
            )}
          </div>
        </React.Fragment>
      )}
    </React.Fragment>
  )
}

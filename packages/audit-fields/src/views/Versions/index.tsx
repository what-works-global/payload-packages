// Vendored from payload@3.84.1 `packages/next/src/views/Versions/index.tsx` (MIT),
// extended with a "Modified By" column resolved from the plugin's audit fields.
// The `.versions` styles ship with the default view, which stays in the admin
// bundle even when overridden, so no stylesheet is imported here.
import type { DocumentViewServerProps, Field, PaginatedDocs, Where } from 'payload'

import { Gutter, ListQueryProvider, SetDocumentStepNav } from '@payloadcms/ui'
import { notFound } from 'next/navigation.js'
import { formatAdminURL, isNumber } from 'payload/shared'
import React from 'react'

import { defaultResolveUserLabel } from '../../defaults.js'
import { getAuditFieldsCustomConfig } from '../../shared.js'
import { buildVersionColumns } from './buildColumns.js'
import { buildModifiedByColumn } from './buildModifiedByColumn.js'
import { VersionDrawerCreatedAtCell } from './cells/VersionDrawerCreatedAtCell.js'
import { fetchLatestVersion, fetchVersions } from './fetchVersions.js'
import { VersionsViewClient } from './index.client.js'

const baseClass = 'versions'

const hasNamedField = (fields: Field[], name: null | string): boolean => {
  return Boolean(name) && fields.some((field) => 'name' in field && field.name === name)
}

export async function AuditVersionsView(props: DocumentViewServerProps) {
  const {
    hasPublishedDoc,
    initPageResult: {
      collectionConfig,
      docID: id,
      globalConfig,
      req,
      req: {
        i18n,
        payload: { config },
        t,
        user,
      },
    },
    routeSegments: segments,
    searchParams: { limit, page, sort } = {},
    versions: { disableGutter = false, useVersionDrawerCreatedAtCell = false } = {},
  } = props

  const entityConfig = collectionConfig || globalConfig
  const draftsEnabled = Boolean(entityConfig?.versions?.drafts)

  const collectionSlug = collectionConfig?.slug
  const globalSlug = globalConfig?.slug

  const isTrashed = segments[2] === 'trash'

  const {
    localization,
    routes: { api: apiRoute },
  } = config

  const whereQuery: {
    and: Array<{ parent?: { equals: number | string }; snapshot?: { not_equals: boolean } }>
  } & Where = {
    and: [],
  }
  if (localization && draftsEnabled) {
    whereQuery.and.push({
      snapshot: {
        not_equals: true,
      },
    })
  }

  const defaultLimit = collectionSlug ? collectionConfig?.admin?.pagination?.defaultLimit : 10

  const limitToUse = isNumber(limit) ? Number(limit) : defaultLimit

  const versionsData: null | PaginatedDocs = await fetchVersions({
    collectionSlug,
    depth: 0,
    globalSlug,
    limit: limitToUse,
    locale: req.locale ?? undefined,
    overrideAccess: false,
    page: page ? parseInt(page.toString(), 10) : undefined,
    parentID: id,
    req,
    sort: sort as string,
    user: user ?? undefined,
    where: whereQuery,
  })

  if (!versionsData) {
    return notFound()
  }

  const [currentlyPublishedVersion, latestDraftVersion] = await Promise.all([
    hasPublishedDoc
      ? fetchLatestVersion({
          collectionSlug,
          depth: 0,
          globalSlug,
          locale: req.locale ?? undefined,
          overrideAccess: false,
          parentID: id,
          req,
          select: {
            id: true,
            updatedAt: true,
            version: {
              _status: true,
              updatedAt: true,
            },
          },
          status: 'published',
          user: user ?? undefined,
          where: localization
            ? {
                snapshot: {
                  not_equals: true,
                },
              }
            : undefined,
        })
      : Promise.resolve(null),
    draftsEnabled
      ? fetchLatestVersion({
          collectionSlug,
          depth: 0,
          globalSlug,
          locale: req.locale ?? undefined,
          overrideAccess: false,
          parentID: id,
          req,
          select: {
            id: true,
            updatedAt: true,
            version: {
              _status: true,
              updatedAt: true,
            },
          },
          status: 'draft',
          user: user ?? undefined,
          where: localization
            ? {
                snapshot: {
                  not_equals: true,
                },
              }
            : undefined,
        })
      : Promise.resolve(null),
  ])

  const fetchURL = formatAdminURL({
    apiRoute,
    path: collectionSlug ? `/${collectionSlug}/versions` : `/${globalSlug}/versions`,
  })

  // Resolve the audit fields this entity actually carries; the column is skipped
  // entirely when the plugin isn't managing fields here.
  const auditConfig = getAuditFieldsCustomConfig(config)
  const entityFields = entityConfig?.fields ?? []
  const createdByFieldName =
    auditConfig && hasNamedField(entityFields, auditConfig.createdByFieldName)
      ? auditConfig.createdByFieldName
      : null
  const lastModifiedByFieldName =
    auditConfig && hasNamedField(entityFields, auditConfig.lastModifiedByFieldName)
      ? auditConfig.lastModifiedByFieldName
      : null

  const modifiedByColumn =
    auditConfig && (createdByFieldName || lastModifiedByFieldName)
      ? await buildModifiedByColumn({
          createdByFieldName,
          docs: versionsData.docs,
          i18n,
          label: auditConfig.versionsColumnLabel,
          lastModifiedByFieldName,
          req,
          resolveUserLabel: auditConfig.resolveUserLabel ?? defaultResolveUserLabel,
          userCollections: auditConfig.userCollections,
        })
      : null

  const columns = buildVersionColumns({
    collectionConfig,
    CreatedAtCellOverride: useVersionDrawerCreatedAtCell ? VersionDrawerCreatedAtCell : undefined,
    currentlyPublishedVersion: currentlyPublishedVersion ?? undefined,
    docID: id,
    docs: versionsData.docs,
    globalConfig,
    i18n,
    isTrashed,
    latestDraftVersion: latestDraftVersion ?? undefined,
    modifiedByColumn,
  })

  const pluralLabel =
    typeof collectionConfig?.labels?.plural === 'function'
      ? collectionConfig.labels.plural({ i18n, t })
      : (collectionConfig?.labels?.plural ?? globalConfig?.label)

  const GutterComponent = disableGutter ? React.Fragment : Gutter

  return (
    <React.Fragment>
      <SetDocumentStepNav
        collectionSlug={collectionSlug}
        globalSlug={globalSlug}
        id={id}
        isTrashed={isTrashed}
        pluralLabel={pluralLabel}
        useAsTitle={collectionConfig?.admin?.useAsTitle || globalSlug}
        view={i18n.t('version:versions')}
      />
      <main className={baseClass}>
        <GutterComponent className={`${baseClass}__wrap`}>
          <ListQueryProvider
            data={versionsData}
            modifySearchParams
            orderableFieldName={collectionConfig?.orderable === true ? '_order' : undefined}
            query={{
              limit: limitToUse,
              sort: sort as string,
            }}
          >
            <VersionsViewClient
              baseClass={baseClass}
              columns={columns}
              fetchURL={fetchURL}
              paginationLimits={collectionConfig?.admin?.pagination?.limits}
            />
          </ListQueryProvider>
        </GutterComponent>
      </main>
    </React.Fragment>
  )
}

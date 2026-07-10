import type { I18n } from '@payloadcms/translations'
import type { Column, PaginatedDocs, PayloadRequest, TypeWithVersion } from 'payload'

import { getTranslation } from '@payloadcms/translations'
import { Link, SortColumn } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import type { ResolveAuditUserLabel } from '../../types.js'

import { defaultVersionsColumnLabel } from '../../defaults.js'
import { normalizeUserRef } from '../../utilities/normalizeUserRef.js'

export const buildModifiedByColumn = async ({
  createdByFieldName,
  docs,
  i18n,
  label,
  lastModifiedByFieldName,
  req,
  resolveUserLabel,
  userCollections,
}: {
  createdByFieldName: null | string
  docs: PaginatedDocs<TypeWithVersion<any>>['docs']
  i18n: I18n
  label: null | Record<string, string> | string
  lastModifiedByFieldName: null | string
  req: PayloadRequest
  resolveUserLabel: ResolveAuditUserLabel
  userCollections: string[]
}): Promise<Column> => {
  const fallbackCollection = userCollections[0]

  // The first version of a document may predate any update, so fall back to the
  // creator when no "last modified by" value was captured yet.
  const refs = docs.map((doc) => {
    const version = (doc?.version ?? {}) as Record<string, unknown>
    const raw =
      (lastModifiedByFieldName ? version[lastModifiedByFieldName] : undefined) ??
      (createdByFieldName ? version[createdByFieldName] : undefined)
    return normalizeUserRef(raw, fallbackCollection)
  })

  const idsByCollection = new Map<string, Set<number | string>>()
  for (const ref of refs) {
    if (!ref) {
      continue
    }
    const ids = idsByCollection.get(ref.relationTo) ?? new Set<number | string>()
    ids.add(ref.value)
    idsByCollection.set(ref.relationTo, ids)
  }

  const labelsByKey = new Map<string, string>()

  await Promise.all(
    [...idsByCollection.entries()].map(async ([collectionSlug, ids]) => {
      try {
        const result = await req.payload.find({
          collection: collectionSlug,
          depth: 0,
          limit: ids.size,
          overrideAccess: false,
          pagination: false,
          req,
          user: req.user,
          where: { id: { in: [...ids] } },
        })
        for (const doc of result.docs as Record<string, unknown>[]) {
          let resolved: null | string | undefined
          try {
            resolved = await resolveUserLabel({ relationTo: collectionSlug, req, user: doc })
          } catch {
            resolved = null
          }
          labelsByKey.set(`${collectionSlug}:${String(doc.id)}`, String(resolved || doc.id))
        }
      } catch {
        // The current user may not be allowed to read this collection — cells fall
        // back to the raw ID below.
      }
    }),
  )

  const {
    routes: { admin: adminRoute },
  } = req.payload.config

  return {
    accessor: 'modifiedBy',
    active: true,
    field: {
      name: '',
      type: 'text',
    },
    Heading: (
      <SortColumn
        disable
        Label={getTranslation(label ?? defaultVersionsColumnLabel, i18n)}
        name="modifiedBy"
      />
    ),
    renderedCells: docs.map((_, i) => {
      const ref = refs[i]
      if (!ref) {
        return <React.Fragment key={i}>—</React.Fragment>
      }
      const userLabel = labelsByKey.get(`${ref.relationTo}:${String(ref.value)}`)
      if (!userLabel) {
        return <React.Fragment key={i}>{String(ref.value)}</React.Fragment>
      }
      return (
        <Link
          href={formatAdminURL({
            adminRoute,
            path: `/collections/${ref.relationTo}/${String(ref.value)}`,
          })}
          key={i}
          prefetch={false}
        >
          {userLabel}
        </Link>
      )
    }),
  }
}

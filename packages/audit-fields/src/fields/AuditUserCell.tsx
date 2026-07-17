import type { DefaultServerCellComponentProps, Payload, PayloadRequest } from 'payload'

import { Link } from '@payloadcms/ui'
import { headers as getHeaders } from 'next/headers.js'
import { createLocalReq } from 'payload'
import { formatAdminURL } from 'payload/shared'
import React, { cache } from 'react'

import { defaultResolveUserLabel } from '../defaults.js'
import { getAuditFieldsCustomConfig } from '../shared.js'
import { normalizeUserRef } from '../utilities/normalizeUserRef.js'

/**
 * Recovers a local `req` carrying the *viewing* user. Unlike the field display and
 * versions view, the list-cell render path exposes only `payload` — no `req` — so we
 * authenticate from the incoming request headers to keep access control consistent
 * (an unreadable user document falls back to the raw ID). Memoized per render pass,
 * so the auth round-trip runs once per page rather than once per cell.
 */
const getViewingReq = cache(async (payload: Payload): Promise<PayloadRequest> => {
  let user: PayloadRequest['user'] = null
  try {
    const headers = await getHeaders()
    ;({ user } = await payload.auth({ headers }))
  } catch {
    // Rendered outside a request scope, or auth failed — resolve without a user,
    // which `overrideAccess: false` treats as no read access.
  }
  return createLocalReq({ user: user ?? undefined }, payload)
})

/**
 * Resolves the label (and whether it should link) for a single attributed user.
 * Memoized per (payload, collection, id) so an author appearing across many rows —
 * or in both the "Created By" and "Last Modified By" columns — is fetched only once
 * per page.
 */
const resolveAuditUser = cache(
  async (
    payload: Payload,
    relationTo: string,
    value: number | string,
  ): Promise<{ label: string; linked: boolean }> => {
    const resolveUserLabel =
      getAuditFieldsCustomConfig(payload.config)?.resolveUserLabel ?? defaultResolveUserLabel
    const req = await getViewingReq(payload)

    try {
      const result = await payload.find({
        collection: relationTo,
        depth: 0,
        limit: 1,
        overrideAccess: false,
        pagination: false,
        req,
        user: req.user ?? undefined,
        where: { id: { equals: value } },
      })
      const userDoc = result.docs[0] as Record<string, unknown> | undefined
      if (userDoc) {
        const resolved = await resolveUserLabel({ relationTo, req, user: userDoc })
        return { label: resolved || String(value), linked: true }
      }
    } catch {
      // The viewing user may not be allowed to read the user collection — fall back
      // to the raw ID without a link.
    }
    return { label: String(value), linked: false }
  },
)

/**
 * List-view cell for an audit field, the counterpart to `AuditUserField`. Renders
 * the attributed user's resolved label (default: email → username → ID) linked to
 * the user document, so the list matches the document view instead of showing a raw
 * relationship ID.
 */
export async function AuditUserCell(props: DefaultServerCellComponentProps) {
  const { cellData, payload } = props

  const auditConfig = getAuditFieldsCustomConfig(payload.config)
  const ref = normalizeUserRef(cellData, auditConfig?.userCollections[0])

  if (!ref) {
    return <React.Fragment>—</React.Fragment>
  }

  const { label, linked } = await resolveAuditUser(payload, ref.relationTo, ref.value)

  if (!linked) {
    return <React.Fragment>{label}</React.Fragment>
  }

  return (
    <Link
      href={formatAdminURL({
        adminRoute: payload.config.routes.admin,
        path: `/collections/${ref.relationTo}/${String(ref.value)}`,
      })}
      prefetch={false}
    >
      {label}
    </Link>
  )
}

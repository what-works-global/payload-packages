import type { CollectionSlug, DefaultServerCellComponentProps, JsonObject, Payload } from 'payload'

import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import { getRedirectsConfig } from '../core/resolved.js'
import { isLinkableCustomDestination } from './shared.js'

type ReferenceRef = { relationTo?: unknown; value?: unknown }

type ToGroup = {
  reference?: null | ReferenceRef
  type?: unknown
  url?: unknown
}

const Empty = () => <span>—</span>

/** The id of a relationship value, whether it arrived populated (an object with `id`) or as a bare id. */
const referenceId = (value: unknown): string | undefined => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') {
      return String(id)
    }
  }
  return undefined
}

/**
 * The resolved front-end path of an internal reference target, using the plugin's
 * per-collection `path()` — the same resolution the cache build uses. Prefers the
 * relationship value already populated on the row; only when it arrived as a bare
 * id (a depth-0 row) does it fetch the document. Returns `null` when the path
 * can't be resolved (unknown collection, missing doc, or `path()` throws/returns
 * nullish), letting the caller fall back to a plain reference label.
 */
const resolveReferencePath = async (
  payload: Payload,
  relationTo: string,
  value: unknown,
  id: string,
): Promise<null | string> => {
  let target
  try {
    target = getRedirectsConfig(payload.config).collections[relationTo]
  } catch {
    return null
  }
  if (!target) {
    return null
  }

  let doc = value && typeof value === 'object' ? (value as JsonObject) : null
  if (!doc) {
    try {
      doc = (await payload.findByID({
        id,
        // The `as CollectionSlug` assertion only matters in consumer projects,
        // where generated types narrow CollectionSlug from string to a union.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        collection: relationTo as CollectionSlug,
        depth: 1,
        disableErrors: true,
        ...(target.select ? { select: target.select } : {}),
      })) as JsonObject | null
    } catch {
      doc = null
    }
  }

  if (!doc) {
    return null
  }

  try {
    return target.path({ doc }) ?? null
  } catch {
    return null
  }
}

/**
 * List cell for the redirect destination (`to`). Internal reference targets render
 * as the resolved document path, linked to that document in the admin; custom-URL
 * targets render the URL, linked externally — except a regex destination that
 * references capture groups (`$1`, `$2`, …), which is incomplete until match time
 * and so is shown as plain text.
 */
export async function RedirectDestinationCell(props: DefaultServerCellComponentProps) {
  const { payload, rowData } = props

  const to = (rowData?.to ?? null) as null | ToGroup
  const matchType = typeof rowData?.matchType === 'string' ? rowData.matchType : 'exact'

  // Internal destination: show the referenced document's resolved path, linked to
  // the document in the admin.
  if (to && to.type === 'reference' && to.reference) {
    const relationTo = to.reference.relationTo
    const id = referenceId(to.reference.value)

    if (typeof relationTo === 'string' && id && payload.collections[relationTo]) {
      const path = await resolveReferencePath(payload, relationTo, to.reference.value, id)
      const href = formatAdminURL({
        adminRoute: payload.config.routes.admin,
        path: `/collections/${relationTo}/${encodeURIComponent(id)}`,
      })
      return (
        <Link href={href} prefetch={false}>
          {path ?? `${relationTo}/${id}`}
        </Link>
      )
    }

    return <Empty />
  }

  // Custom-URL (external) destination.
  const url = typeof to?.url === 'string' ? to.url.trim() : ''
  if (!url) {
    return <Empty />
  }

  // A regex destination that references capture groups isn't a real URL until
  // match time — show it as plain text rather than a broken link.
  if (!isLinkableCustomDestination(url, matchType)) {
    return <span>{url}</span>
  }

  return (
    <a href={url} rel="noopener noreferrer" target="_blank">
      {url}
    </a>
  )
}

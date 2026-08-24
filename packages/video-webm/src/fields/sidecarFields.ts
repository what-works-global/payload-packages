import type { CheckboxField, RelationshipField } from 'payload'

import { asCollectionSlug } from '../core/collectionSlug.js'
import { WEBM_DERIVATIVE_FLAG_FIELD_NAME, WEBM_VERSION_FIELD_NAME } from '../hooks/webmSidecar.js'

/**
 * Read-only sidebar link from an original video to its WebM sidecar document.
 * Populate with `depth: 1` and render `doc.webmVersion?.url ?? doc.url`.
 */
export const webmVersionField = (collectionSlug: string): RelationshipField => ({
  name: WEBM_VERSION_FIELD_NAME,
  type: 'relationship',
  admin: {
    condition: (data) => Boolean(data?.[WEBM_VERSION_FIELD_NAME]),
    position: 'sidebar',
    readOnly: true,
  },
  label: 'WebM version',
  relationTo: asCollectionSlug(collectionSlug),
})

/** Hidden marker separating plugin-managed sidecars from user uploads; indexed for the list filter. */
export const webmDerivativeFlagField = (): CheckboxField => ({
  name: WEBM_DERIVATIVE_FLAG_FIELD_NAME,
  type: 'checkbox',
  admin: {
    hidden: true,
  },
  defaultValue: false,
  index: true,
})

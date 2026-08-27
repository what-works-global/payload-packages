import type { ArrayField, CheckboxField, TextField } from 'payload'

import { asCollectionSlug } from '../core/collectionSlug.js'

/** Array on the source document linking each rendition: rows of `{ preset, video }`. */
export const WEBM_VERSIONS_FIELD_NAME = 'webmVersions'

/** Hidden flag marking a document as a plugin-managed WebM sidecar. */
export const WEBM_DERIVATIVE_FLAG_FIELD_NAME = 'isWebmDerivative'

/** On sidecar documents: which preset produced this rendition. */
export const WEBM_PRESET_FIELD_NAME = 'webmPreset'

/**
 * Read-only sidebar list linking each generated rendition. Row order follows the
 * preset declaration order (= preference order). Populate with `depth: 1` and use
 * the `/frontend` helpers to build `<video>` sources with the original as fallback.
 */
export const webmVersionsField = (collectionSlug: string): ArrayField => ({
  name: WEBM_VERSIONS_FIELD_NAME,
  type: 'array',
  admin: {
    condition: (data) => Boolean((data?.[WEBM_VERSIONS_FIELD_NAME] as unknown[])?.length),
    position: 'sidebar',
    readOnly: true,
  },
  fields: [
    {
      name: 'preset',
      type: 'text',
      required: true,
    },
    {
      name: 'video',
      type: 'relationship',
      relationTo: asCollectionSlug(collectionSlug),
      required: true,
    },
  ],
  label: 'WebM versions',
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

/** Hidden preset name on sidecar documents, for debugging and queries. */
export const webmPresetField = (): TextField => ({
  name: WEBM_PRESET_FIELD_NAME,
  type: 'text',
  admin: {
    hidden: true,
  },
})

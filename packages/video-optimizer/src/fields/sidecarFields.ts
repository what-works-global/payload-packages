import type { ArrayField, CheckboxField, NumberField, TextField, Where } from 'payload'

import { asCollectionSlug } from '../core/collectionSlug.js'

/** Array on the source document linking each rendition: rows of `{ preset, video }`. */
export const RENDITIONS_FIELD_NAME = 'renditions'

/** Hidden flag marking a document as a plugin-managed WebM sidecar. */
export const VIDEO_DERIVATIVE_FLAG_FIELD_NAME = 'isVideoDerivative'

/** On sidecar documents: which preset produced this rendition. */
export const RENDITION_PRESET_FIELD_NAME = 'renditionPreset'

/** Counter bumped on every (re)queue, so a superseded job discards its work. */
export const RENDITION_GENERATION_FIELD_NAME = 'renditionGeneration'

/**
 * Excludes plugin-managed renditions from a query. Sidecars are ordinary documents
 * in the same collection (that is what keeps them on the collection's own storage
 * adapter), so they surface in `payload.find`, REST/GraphQL lists **and admin
 * relationship pickers** unless they're filtered out:
 *
 * ```ts
 * // your own queries
 * payload.find({ collection: 'media', where: EXCLUDE_VIDEO_DERIVATIVES })
 *
 * // every relationship/upload field pointing at a converted collection
 * { name: 'hero', type: 'upload', relationTo: 'media', filterOptions: EXCLUDE_VIDEO_DERIVATIVES }
 * ```
 */
export const EXCLUDE_VIDEO_DERIVATIVES: Where = {
  [VIDEO_DERIVATIVE_FLAG_FIELD_NAME]: { not_equals: true },
}

/**
 * Links each generated rendition, in preset declaration (= preference) order.
 * Hidden in the admin — the VideoConversionPanel presents the renditions as a
 * condensed table with open/regenerate actions — but fully readable through the
 * API: populate with `depth: 1` and use the `/frontend` helpers to build
 * `<video>` sources.
 *
 * A row with no `video` records a preset the job deliberately did not store
 * (`skippedReason`), which is what stops later runs from re-encoding it forever.
 */
export const renditionsField = (collectionSlug: string): ArrayField => ({
  name: RENDITIONS_FIELD_NAME,
  type: 'array',
  admin: {
    hidden: true,
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
    },
    // Measured off the encoded file. Payload only derives width/height for images,
    // and picking a rendition by how wide it is shouldn't cost a second query.
    {
      name: 'width',
      type: 'number',
    },
    {
      name: 'height',
      type: 'number',
    },
    {
      // Deliberately text, not select: a future skip reason must never fail
      // validation on a document written by a newer version of the plugin.
      name: 'skippedReason',
      type: 'text',
    },
  ],
  label: 'WebM versions',
})

/** Hidden marker separating plugin-managed sidecars from user uploads; indexed for the list filter. */
export const videoDerivativeFlagField = (): CheckboxField => ({
  name: VIDEO_DERIVATIVE_FLAG_FIELD_NAME,
  type: 'checkbox',
  admin: {
    hidden: true,
  },
  defaultValue: false,
  index: true,
})

/** Hidden preset name on sidecar documents, for debugging and queries. */
export const renditionPresetField = (): TextField => ({
  name: RENDITION_PRESET_FIELD_NAME,
  type: 'text',
  admin: {
    hidden: true,
  },
})

/**
 * Bumped every time a conversion is queued (new upload, replaced file, regenerate).
 * The job carries the value it was queued with and refuses to write if the document
 * has moved on since — the guard that makes a slow or duplicated run harmless.
 */
export const renditionGenerationField = (): NumberField => ({
  name: RENDITION_GENERATION_FIELD_NAME,
  type: 'number',
  admin: {
    hidden: true,
  },
  defaultValue: 0,
})

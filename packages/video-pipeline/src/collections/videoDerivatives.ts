import type { CollectionConfig } from 'payload'

import type { ResolvedVideoPipelineOptions } from '../types.js'

/**
 * Real upload-enabled collection. Register this same slug wherever the host
 * project's storage plugin (e.g. `@payloadcms/storage-s3`) already lists its
 * `media` collection — that's the only place storage is configured; this
 * collection has no idea whether it's writing to local disk or S3.
 *
 * create/update/delete are locked down because Payload's Local API (what the
 * job tasks use) defaults to `overrideAccess: true` — so the task code can
 * still write here even though the REST/GraphQL API and admin UI can't. Never
 * pass `overrideAccess: false` when calling into this collection.
 */
export function buildVideoDerivativesCollection(
  options: ResolvedVideoPipelineOptions,
): CollectionConfig {
  return {
    slug: options.derivativesCollectionSlug,
    access: {
      create: () => false,
      delete: () => false,
      read: () => true,
      update: () => false,
    },
    admin: { hidden: true },
    fields: [
      {
        name: 'media',
        type: 'relationship',
        index: true,
        relationTo: options.collections,
        required: true,
      },
      { name: 'sizeSlug', type: 'text', index: true, required: true },
      { name: 'label', type: 'text' },
      { name: 'breakpointMinWidth', type: 'number' },
      { name: 'resolutionHeight', type: 'number', required: true },
      { name: 'format', type: 'select', options: ['mp4', 'webm'], required: true },
      { name: 'videoBitrateKbps', type: 'number' },
      { name: 'crf', type: 'number' },
      { name: 'audioBitrateKbps', type: 'number' },
      { name: 'cpuUsed', type: 'number' },
      // Payload's upload feature doesn't auto-populate width/height for
      // non-image mimetypes, so these are ours to fill in from ffprobe.
      { name: 'encodedWidth', type: 'number' },
      { name: 'encodedHeight', type: 'number' },
      { name: 'generatedAt', type: 'date' },
    ],
    upload: true,
  }
}

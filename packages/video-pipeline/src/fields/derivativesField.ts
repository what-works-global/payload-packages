import type { Field } from 'payload'

import type { ResolvedVideoPipelineOptions } from '../types.js'

export function buildDerivativesField(options: ResolvedVideoPipelineOptions): Field {
  return {
    name: 'videoDerivatives',
    type: 'array',
    admin: {
      condition: (data) => Boolean(data?.mimeType?.startsWith?.('video')),
      description: 'Generated automatically. Use Regenerate to force a re-run.',
      readOnly: true,
    },
    fields: [
      { name: 'sizeSlug', type: 'text', required: true },
      {
        name: 'status',
        type: 'select',
        defaultValue: 'pending',
        options: ['pending', 'processing', 'done', 'error'],
        required: true,
      },
      { name: 'label', type: 'text' },
      { name: 'breakpointMinWidth', type: 'number' },
      { name: 'resolutionHeight', type: 'number' },
      { name: 'format', type: 'text' },
      { name: 'videoBitrateKbps', type: 'number' },
      { name: 'crf', type: 'number' },
      { name: 'audioBitrateKbps', type: 'number' },
      { name: 'cpuUsed', type: 'number' },
      { name: 'derivative', type: 'relationship', relationTo: options.derivativesCollectionSlug },
      { name: 'error', type: 'text' },
      { name: 'generatedAt', type: 'date' },
    ],
    label: 'Video derivatives',
  }
}

export const regenerateButtonField: Field = {
  name: 'videoRegenerateTrigger',
  type: 'ui',
  admin: {
    components: {
      Field: '@whatworks/payload-video-pipeline/client#RegenerateButton',
    },
    condition: (data) => Boolean(data?.mimeType?.startsWith?.('video')),
  },
}

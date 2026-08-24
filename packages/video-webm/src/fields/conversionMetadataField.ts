import type { GroupField } from 'payload'

import { METADATA_GROUP_NAME } from '../hooks/stampConversionMetadata.js'

/**
 * Read-only sidebar group stamped by the plugin's hooks. Hidden until a conversion
 * (or a recorded skip) actually happened, so image-only docs stay uncluttered.
 */
export const conversionMetadataField = (): GroupField => ({
  name: METADATA_GROUP_NAME,
  type: 'group',
  admin: {
    condition: (data) =>
      Boolean(data?.[METADATA_GROUP_NAME]?.converted || data?.[METADATA_GROUP_NAME]?.skippedReason),
    position: 'sidebar',
    readOnly: true,
  },
  fields: [
    {
      name: 'converted',
      type: 'checkbox',
      label: 'Converted to WebM',
    },
    {
      name: 'originalFilename',
      type: 'text',
    },
    {
      name: 'originalMimeType',
      type: 'text',
    },
    {
      name: 'originalFilesize',
      type: 'number',
      admin: {
        description:
          'Size of the uploaded source file in bytes, before conversion. Compare with the document filesize for the savings.',
      },
    },
    {
      name: 'encodeDurationMs',
      type: 'number',
      admin: {
        description: 'Wall-clock ffmpeg encode time in milliseconds.',
      },
    },
    {
      name: 'skippedReason',
      type: 'select',
      options: [
        { label: 'ffmpeg failed', value: 'ffmpeg-failed' },
        { label: 'Input too large', value: 'input-too-large' },
        { label: 'WebM output was larger', value: 'output-larger' },
        { label: 'Storing the WebM sidecar failed', value: 'derivative-failed' },
      ],
    },
  ],
  label: 'WebM conversion',
})

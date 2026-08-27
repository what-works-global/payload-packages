import type { GroupField } from 'payload'

export const METADATA_GROUP_NAME = 'videoWebm'

/**
 * Read-only sidebar group tracking the conversion lifecycle. Hidden until the
 * plugin actually recorded something, so image-only docs stay uncluttered.
 */
export const conversionMetadataField = (): GroupField => ({
  name: METADATA_GROUP_NAME,
  type: 'group',
  admin: {
    condition: (data) => Boolean(data?.[METADATA_GROUP_NAME]?.status),
    position: 'sidebar',
    readOnly: true,
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Queued', value: 'queued' },
        { label: 'Complete', value: 'complete' },
        { label: 'Skipped', value: 'skipped' },
        { label: 'Failed', value: 'failed' },
      ],
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
          'Size of the source file in bytes. Compare with the WebM version’s filesize for the savings.',
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
        { label: 'Input too large', value: 'input-too-large' },
        { label: 'WebM output was larger', value: 'output-larger' },
      ],
    },
    {
      name: 'error',
      type: 'text',
      admin: {
        description: 'Last conversion job error; retries may still complete later.',
      },
    },
  ],
  label: 'WebM conversion',
})

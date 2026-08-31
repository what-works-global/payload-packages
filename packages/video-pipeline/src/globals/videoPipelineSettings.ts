import type { GlobalConfig } from 'payload'

import type { ResolvedVideoPipelineOptions } from '../types.js'

export function buildVideoPipelineSettingsGlobal(
  options: ResolvedVideoPipelineOptions,
): GlobalConfig {
  return {
    slug: options.settingsGlobalSlug,
    access: { read: () => true },
    fields: [
      {
        name: 'videoSizes',
        type: 'array',
        defaultValue: options.defaultVideoSizes,
        fields: [
          {
            name: 'slug',
            type: 'text',
            admin: { description: "Stable id, e.g. '720p-webm'." },
            required: true,
          },
          { name: 'label', type: 'text', required: true },
          {
            name: 'breakpointMinWidth',
            type: 'number',
            admin: {
              description:
                'Viewport px this variant activates at. Leave blank on exactly one size — that one is the fallback used below every other breakpoint.',
            },
          },
          {
            name: 'resolutionHeight',
            type: 'number',
            admin: { description: 'Target output height; width auto-scales.' },
            required: true,
          },
          {
            name: 'format',
            type: 'select',
            defaultValue: 'webm',
            options: [
              { label: 'WebM (VP9/Opus)', value: 'webm' },
              { label: 'MP4 (H.264/AAC)', value: 'mp4' },
            ],
            required: true,
          },
          {
            name: 'videoBitrateKbps',
            type: 'number',
            admin: { description: 'Leave blank to use CRF instead.' },
          },
          { name: 'crf', type: 'number', defaultValue: 32 },
          { name: 'audioBitrateKbps', type: 'number', defaultValue: 96, required: true },
          {
            name: 'cpuUsed',
            type: 'number',
            admin: { description: 'VP9 only; higher = faster/lower quality.' },
            defaultValue: 4,
            required: true,
          },
        ],
        label: 'Output sizes (also used as responsive breakpoints)',
      },
      {
        name: 'backfillTrigger',
        type: 'ui',
        admin: {
          components: {
            Field: '@whatworks/payload-video-pipeline/client#BackfillButton',
          },
        },
      },
    ],
    label: 'Video Pipeline Settings',
  }
}

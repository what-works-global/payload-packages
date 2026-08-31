import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { videoPipelinePlugin } from '@whatworks/payload-video-pipeline'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildDevConfig({
  collections: [
    {
      slug: 'media',
      fields: [],
      upload: true,
    },
  ],
  dbName: 'payload-video-pipeline-dev',
  dirname,
  plugins: [
    videoPipelinePlugin({
      collections: ['media'],
      defaultVideoSizes: [
        {
          slug: '480p-webm',
          label: '480p',
          audioBitrateKbps: 96,
          cpuUsed: 5,
          crf: 34,
          format: 'webm',
          resolutionHeight: 480,
        },
        // {
        //   slug: '720p-webm',
        //   label: '720p',
        //   audioBitrateKbps: 96,
        //   breakpointMinWidth: 768,
        //   cpuUsed: 4,
        //   crf: 32,
        //   format: 'webm',
        //   resolutionHeight: 720,
        // },
        {
          slug: '1080p-webm',
          label: '1080p',
          audioBitrateKbps: 128,
          breakpointMinWidth: 1280,
          cpuUsed: 3,
          crf: 30,
          format: 'webm',
          resolutionHeight: 1080,
        },
      ],
    }),
  ],
})

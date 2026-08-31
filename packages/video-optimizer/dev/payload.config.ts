import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import {
  EXCLUDE_VIDEO_DERIVATIVES,
  videoOptimizerPlugin,
  widthPresets,
} from '@whatworks/payload-video-optimizer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// SQLite file lives in .dbs/ (gitignored). Delete it to start from scratch.
const dbDir = path.resolve(dirname, '.dbs')
fs.mkdirSync(dbDir, { recursive: true })

export default buildDevConfig({
  collections: [
    {
      slug: 'media',
      admin: {
        description:
          'Upload an mp4/mov — the source stores unchanged and the response returns immediately; a background job then encodes the presets and links them under "WebM versions" in the sidebar. Refresh to watch the status flip from queued to complete.',
      },
      fields: [{ name: 'alt', type: 'text' }],
      upload: {
        // Deliberately restricted to sources only: exercises the plugin widening
        // mimeTypes with video/webm so the sidecars pass validation.
        mimeTypes: ['video/mp4', 'video/quicktime', 'image/*'],
        staticDir: path.resolve(dirname, 'media'),
      },
    },
    {
      slug: 'pages',
      admin: {
        description:
          'Demonstrates the picker rule: `baseListFilter` only hides renditions from the media LIST view, so an upload field needs filterOptions of its own. Open "hero" — only source videos are offered. Delete the filterOptions to see every rendition show up.',
        useAsTitle: 'title',
      },
      fields: [
        { name: 'title', type: 'text' },
        {
          name: 'hero',
          type: 'upload',
          filterOptions: EXCLUDE_VIDEO_DERIVATIVES,
          relationTo: 'media',
        },
      ],
    },
  ],
  db: sqliteAdapter({
    client: { url: `file:${path.join(dbDir, 'dev.db')}` },
    push: true,
  }),
  dirname,
  plugins: [
    videoOptimizerPlugin({
      collections: ['media'],
      // The dev server is a long-running Node process, so fire-and-forget is safe —
      // the upload response returns while ffmpeg works in the background.
      dispatch: (_job, { run }) => {
        void run()
      },
      encoding: {
        // Faster encodes for local fiddling; drop back to the defaults in real apps.
        speed: 4,
      },
      // A 9:16 crop for portrait slots, framed by the document's focal point.
      // Upload a landscape clip and compare it against the rungs above.
      portrait: { widths: [720] },
      // A small width ladder — the sizes a layout actually asks for. Declaration
      // order is preference order, so delivery sizes come first. Drop this line to
      // get the default six-rung ladder.
      presets: widthPresets([1280, 640]),
    }),
  ],
})

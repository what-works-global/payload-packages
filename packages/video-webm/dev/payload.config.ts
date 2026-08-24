import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { videoWebmPlugin } from '@whatworks/payload-video-webm'
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
        description: 'Upload an mp4/mov here — it lands in storage as WebM.',
      },
      fields: [{ name: 'alt', type: 'text' }],
      upload: {
        // Deliberately restricted to sources only: exercises the plugin widening
        // mimeTypes with video/webm so the converted file passes validation.
        mimeTypes: ['video/mp4', 'video/quicktime', 'image/*'],
        staticDir: path.resolve(dirname, 'media'),
      },
    },
    {
      // Not targeted by the plugin (see `collections` below) — uploads stay untouched.
      slug: 'raw-media',
      fields: [],
      upload: {
        staticDir: path.resolve(dirname, 'raw-media'),
      },
    },
  ],
  db: sqliteAdapter({
    client: { url: `file:${path.join(dbDir, 'dev.db')}` },
    push: true,
  }),
  dirname,
  plugins: [
    videoWebmPlugin({
      collections: ['media'],
      encoding: {
        // Faster encodes for local fiddling; drop back to the defaults in real apps.
        speed: 4,
      },
    }),
  ],
})

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { redirectsPlugin } from '@whatworks/payload-redirects'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cache } from './redirectsCache.js'
import { seed } from './seed.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// SQLite file lives in .dbs/ (gitignored). Delete it to reseed from scratch.
const dbDir = path.resolve(dirname, '.dbs')
fs.mkdirSync(dbDir, { recursive: true })

export default buildDevConfig({
  collections: [
    {
      slug: 'pages',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text', required: true, unique: true },
      ],
      versions: { drafts: true },
    },
  ],
  db: sqliteAdapter({
    client: { url: `file:${path.join(dbDir, 'dev.db')}` },
    push: true,
  }),
  dirname,
  onInit: seed,
  plugins: [
    redirectsPlugin({
      cache,
      collections: {
        pages: {
          path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`),
        },
      },
    }),
  ],
})

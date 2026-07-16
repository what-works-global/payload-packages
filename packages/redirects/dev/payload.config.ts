import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { redirectsPlugin } from '@whatworks/payload-redirects'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cache } from './redirectsCache.js'
import { seed } from './seed.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// SQLite file lives in .dbs/ (gitignored) by default. Override with
// REDIRECTS_DEV_DB (e.g. a throwaway path for e2e) so a test run never clobbers
// local dev state. Delete the file to reseed from scratch.
const dbFile = process.env.REDIRECTS_DEV_DB
  ? path.resolve(process.env.REDIRECTS_DEV_DB)
  : path.join(path.resolve(dirname, '.dbs'), 'dev.db')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })

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
    client: { url: `file:${dbFile}` },
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
  // In dev, Payload spawns `payload generate:types` on every HMR init. The e2e
  // harness kills the whole sandbox process group, which orphans any in-flight
  // worker (they then spin at ~100% CPU). Disable the auto-spawn under e2e; a
  // normal `pnpm dev` keeps auto-refreshing types on save.
  ...(process.env.REDIRECTS_DEV_DISABLE_AUTOGEN ? { typescript: { autoGenerate: false } } : {}),
})

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { devUser } from '@whatworks/dev-fixture/credentials'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { sitemapPlugin } from '@whatworks/payload-sitemap'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { seed } from './seed.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// SQLite file lives in .dbs/ (gitignored). Delete it to reseed from scratch.
const dbDir = path.resolve(dirname, '.dbs')
fs.mkdirSync(dbDir, { recursive: true })

export default buildDevConfig({
  admin: {
    // prefillOnly keeps requests anonymous until you actually log in, so the
    // JSON endpoint's default access control (403 without a user) is observable.
    autoLogin: {
      email: devUser.email,
      password: devUser.password,
      prefillOnly: true,
    },
  },
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
    {
      // Deliberately no drafts — exercises the no-`_status` query path.
      slug: 'legal',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text', required: true, unique: true },
      ],
    },
  ],
  db: sqliteAdapter({
    client: { url: `file:${path.join(dbDir, 'dev.db')}` },
    push: true,
  }),
  dirname,
  onInit: seed,
  plugins: [
    sitemapPlugin({
      collections: {
        legal: {
          path: ({ doc }) => `/legal/${doc.slug}`,
          select: { slug: true },
        },
        pages: {
          path: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`),
          select: { slug: true },
        },
      },
      // REST endpoints are disabled by default; enabled here to exercise them.
      endpoints: { json: true },
      routes: [{ path: '/search' }],
      // No siteUrl on purpose — with no env vars set either, the origin is
      // derived from each incoming request (exercises the last-resort default).
    }),
  ],
})

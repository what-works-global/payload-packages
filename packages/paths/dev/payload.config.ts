import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { createNestedDocsGenerateURL, createParentField } from '@whatworks/payload-paths'
import { nextPathsPlugin } from '@whatworks/payload-paths/next'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { pathsConfig } from './paths.config.js'
import { seed } from './seed.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// SQLite file lives in .dbs/ (gitignored) by default. Override with
// PATHS_DEV_DB (e.g. a throwaway path for e2e). Delete the file to reseed.
const dbFile = process.env.PATHS_DEV_DB
  ? path.resolve(process.env.PATHS_DEV_DB)
  : path.join(path.resolve(dirname, '.dbs'), 'dev.db')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })

const titleAndSlug = [
  { name: 'title', type: 'text' as const, required: true },
  { name: 'slug', type: 'text' as const, required: true },
]

export default buildDevConfig({
  collections: [
    // Nested via the nested-docs plugin — paths auto-detects the strategy.
    {
      slug: 'pages',
      admin: { useAsTitle: 'title' },
      fields: [...titleAndSlug],
      versions: { drafts: true },
    },
    // Nested WITHOUT the nested-docs plugin — the plugin's own cascade.
    {
      slug: 'docs',
      admin: { useAsTitle: 'title' },
      fields: [...titleAndSlug, createParentField('docs')],
      versions: { drafts: true },
    },
    // Flat, served under a /blog prefix.
    {
      slug: 'posts',
      admin: { useAsTitle: 'title' },
      fields: [...titleAndSlug],
      versions: { drafts: true },
    },
  ],
  db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
  dirname,
  onInit: seed,
  plugins: [
    nestedDocsPlugin({
      collections: ['pages'],
      generateURL: createNestedDocsGenerateURL({ homeSlug: 'home' }),
    }),
    // Must come AFTER nestedDocsPlugin so the breadcrumbs field exists.
    nextPathsPlugin(pathsConfig),
  ],
  // Payload spawns `payload generate:types` on every dev init; the e2e harness
  // kills the sandbox process group, orphaning any in-flight worker. Disable
  // the auto-spawn under e2e; a normal `pnpm dev` keeps refreshing types.
  ...(process.env.PATHS_DEV_DISABLE_AUTOGEN ? { typescript: { autoGenerate: false } } : {}),
})

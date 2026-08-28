import type { SanitizedConfig } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig } from 'payload'

import type { SitemapPluginConfig } from '../../src/types.js'

import { sitemapPlugin } from '../../src/index.js'

export const makeTmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'payload-sitemap-group-test-'))

/**
 * Each `adminFields.group` suite lives in its own file so vitest gives it a
 * dedicated process. `getPayload` caches one instance per process and only
 * learned to key that cache in Payload 3.54.0 — above this package's 3.30.0
 * peer floor — so two suites sharing a process would silently share the first
 * suite's instance and config.
 */
export const buildAdminFieldsConfig = (
  tmpDir: string,
  dbFile: string,
  adminFields: SitemapPluginConfig['adminFields'],
  collections: Parameters<typeof buildConfig>[0]['collections'],
): Promise<SanitizedConfig> =>
  buildConfig({
    collections,
    db: sqliteAdapter({
      client: { url: `file:${path.join(tmpDir, dbFile)}` },
      push: true,
    }),
    plugins: [
      sitemapPlugin({
        adminFields,
        cache: 'memory',
        collections: {
          legal: {
            path: ({ doc }) => `/legal/${doc.slug}`,
            select: { slug: true },
          },
          pages: {
            path: ({ doc }) => `/${doc.slug}`,
            select: { slug: true },
          },
        },
        siteUrl: 'https://example.com',
      }),
    ],
    secret: 'test-secret',
    telemetry: false,
    // Prevents getPayload from spawning orphaned `generate:types` workers (see AGENTS.md).
    typescript: { autoGenerate: false },
  })

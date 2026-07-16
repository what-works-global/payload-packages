import type { Payload, SanitizedConfig } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SitemapPluginConfig } from '../src/types.js'

import { getSitemapEntries, sitemapPlugin } from '../src/index.js'

let tmpDir: string

const buildTestConfig = (
  dbFile: string,
  adminFields: SitemapPluginConfig['adminFields'],
  pagesFields: Parameters<typeof buildConfig>[0]['collections'],
): Promise<SanitizedConfig> =>
  buildConfig({
    collections: pagesFields,
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

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-sitemap-group-test-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { force: true, recursive: true })
})

describe('adminFields.group at generation time', () => {
  let payload: Payload

  beforeAll(async () => {
    const config = await buildTestConfig('group.db', { group: 'meta' }, [
      {
        slug: 'pages',
        fields: [
          { name: 'slug', type: 'text', required: true },
          { name: 'meta', type: 'group', fields: [{ name: 'title', type: 'text' }] },
        ],
        versions: { drafts: true },
      },
      {
        // No `meta` group — the plugin must create it.
        slug: 'legal',
        fields: [{ name: 'slug', type: 'text', required: true }],
      },
    ])

    payload = await getPayload({ config })

    await payload.create({
      collection: 'pages',
      data: { slug: 'visible', _status: 'published' },
    })
    await payload.create({
      collection: 'pages',
      data: { slug: 'hidden', _status: 'published', meta: { excludeFromSitemap: true } },
    })
    await payload.create({ collection: 'legal', data: { slug: 'terms' } })
    await payload.create({
      collection: 'legal',
      data: { slug: 'internal', meta: { excludeFromSitemap: true } },
    })
  }, 120_000)

  afterAll(async () => {
    await payload?.destroy()
  })

  it('filters excluded docs via the grouped path on a pre-existing group', async () => {
    const entries = await getSitemapEntries(payload)
    const locs = entries.pages.map((entry) => entry.loc)
    expect(locs).toContain('https://example.com/visible')
    expect(locs).not.toContain('https://example.com/hidden')
  })

  it('filters excluded docs via the plugin-created group', async () => {
    const entries = await getSitemapEntries(payload)
    expect(entries.legal.map((entry) => entry.loc)).toEqual(['https://example.com/legal/terms'])
  })
})

describe('adminFields.group with a nested path', () => {
  let payload: Payload

  beforeAll(async () => {
    const config = await buildTestConfig('nested.db', { group: 'seo.metadata' }, [
      {
        slug: 'pages',
        fields: [
          { name: 'slug', type: 'text', required: true },
          {
            type: 'tabs',
            tabs: [
              // Named tab holding an existing group — both dotted segments pre-exist.
              { name: 'seo', fields: [{ name: 'metadata', type: 'group', fields: [] }] },
            ],
          },
        ],
        versions: { drafts: true },
      },
      {
        // Neither segment exists — the plugin must create the whole chain.
        slug: 'legal',
        fields: [{ name: 'slug', type: 'text', required: true }],
      },
    ])

    // getPayload caches per-process under options.key — without a distinct key
    // this would return the other suite's instance.
    payload = await getPayload({ config, key: 'nested-group' })

    await payload.create({
      collection: 'pages',
      data: { slug: 'visible', _status: 'published' },
    })
    await payload.create({
      collection: 'pages',
      data: {
        slug: 'hidden',
        _status: 'published',
        seo: { metadata: { excludeFromSitemap: true } },
      },
    })
    await payload.create({ collection: 'legal', data: { slug: 'terms' } })
    await payload.create({
      collection: 'legal',
      data: { slug: 'internal', seo: { metadata: { excludeFromSitemap: true } } },
    })
  }, 120_000)

  afterAll(async () => {
    await payload?.destroy()
  })

  it('filters excluded docs via the dotted path inside a named tab', async () => {
    const entries = await getSitemapEntries(payload)
    const locs = entries.pages.map((entry) => entry.loc)
    expect(locs).toContain('https://example.com/visible')
    expect(locs).not.toContain('https://example.com/hidden')
  })

  it('filters excluded docs via the plugin-created chain', async () => {
    const entries = await getSitemapEntries(payload)
    expect(entries.legal.map((entry) => entry.loc)).toEqual(['https://example.com/legal/terms'])
  })
})

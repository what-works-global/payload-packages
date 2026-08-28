import type { Payload } from 'payload'

import fs from 'node:fs'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getSitemapEntries } from '../src/index.js'
import { buildAdminFieldsConfig, makeTmpDir } from './shared/adminFieldsFixture.js'
import { destroyPayload } from './shared/destroyPayload.js'

describe('adminFields.group with a nested path', () => {
  let payload: Payload
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = makeTmpDir()

    const config = await buildAdminFieldsConfig(tmpDir, 'nested.db', { group: 'seo.metadata' }, [
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

    payload = await getPayload({ config })

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
    await destroyPayload(payload)
    fs.rmSync(tmpDir, { force: true, recursive: true })
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

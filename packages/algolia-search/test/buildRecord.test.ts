import type { SanitizedCollectionConfig } from 'payload'

import { describe, expect, it } from 'vitest'

import { buildSearchRecord, loadLexicalConverter } from '../src/index.js'
import { makeContext, pagesCollection } from './helpers.js'

const doc = {
  id: 1,
  slug: 'weather-info',
  body: 'Body copy for the page.',
  breadcrumbs: [
    { label: 'Learn More', url: '/learn-more' },
    { label: 'Weather info', url: '/learn-more/weather-info' },
  ],
  title: 'Weather info',
}

describe('buildSearchRecord', () => {
  it('builds the default record: title, breadcrumb path fallback, labels, content', async () => {
    const record = await buildSearchRecord({
      collection: pagesCollection,
      context: makeContext(),
      doc,
    })
    expect(record).toEqual({
      breadcrumbs: ['Learn More', 'Weather info'],
      collection: 'pages',
      content: 'Body copy for the page.',
      objectID: 'pages:1',
      path: '/learn-more/weather-info',
      title: 'Weather info',
    })
  })

  it('prefers getPath over the breadcrumb fallback, and falls back when it returns nothing', async () => {
    const withGetPath = makeContext({ getPath: () => '/custom/path' })
    expect(
      (await buildSearchRecord({ collection: pagesCollection, context: withGetPath, doc }))?.path,
    ).toBe('/custom/path')

    const withNullGetPath = makeContext({ getPath: () => null })
    expect(
      (await buildSearchRecord({ collection: pagesCollection, context: withNullGetPath, doc }))
        ?.path,
    ).toBe('/learn-more/weather-info')
  })

  it('omits breadcrumbs when there is no trail (single crumb)', async () => {
    const record = await buildSearchRecord({
      collection: pagesCollection,
      context: makeContext(),
      doc: { ...doc, breadcrumbs: [{ label: 'Weather info', url: '/weather-info' }] },
    })
    expect(record?.breadcrumbs).toBeUndefined()
    expect(record?.path).toBe('/weather-info')
  })

  it('applies per-collection contentLimit', async () => {
    const context = makeContext({ collections: { pages: { contentLimit: 9 } } })
    const record = await buildSearchRecord({ collection: pagesCollection, context, doc })
    expect((record?.content as string).length).toBeLessThanOrEqual(9)
  })

  it('record transform: undefined keeps default, extend merges, null opts out', async () => {
    const extend = makeContext({
      collections: {
        pages: {
          record: ({ defaultRecord }) => ({ ...defaultRecord, extra: 'yes', objectID: 'nope' }),
        },
      },
    })
    const extended = await buildSearchRecord({
      collection: pagesCollection,
      context: extend,
      doc,
    })
    expect(extended?.extra).toBe('yes')
    // canonical keys always win
    expect(extended?.objectID).toBe('pages:1')

    const keep = makeContext({ collections: { pages: { record: () => undefined } } })
    expect(
      (await buildSearchRecord({ collection: pagesCollection, context: keep, doc }))?.title,
    ).toBe('Weather info')

    const optOut = makeContext({ collections: { pages: { record: () => null } } })
    expect(
      await buildSearchRecord({ collection: pagesCollection, context: optOut, doc }),
    ).toBeNull()
  })

  it('uses the official Lexical plaintext converter when installed', async () => {
    const converter = await loadLexicalConverter()
    expect(converter).toBeTypeOf('function')

    const newsCollection = {
      slug: 'news',
      admin: { useAsTitle: 'title' },
      fields: [
        { name: 'title', type: 'text' },
        { name: 'content', type: 'richText' },
      ],
      versions: { drafts: {} },
    } as unknown as SanitizedCollectionConfig

    const record = await buildSearchRecord({
      collection: newsCollection,
      context: makeContext(),
      doc: {
        id: 'abc',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Lexical body text', version: 1 }],
                direction: null,
                format: '',
                indent: 0,
                version: 1,
              },
            ],
            direction: null,
            format: '',
            indent: 0,
            version: 1,
          },
        },
        title: 'A story',
      },
    })
    expect(record?.content).toBe('Lexical body text')
    expect(record?.objectID).toBe('news:abc')
  })
})

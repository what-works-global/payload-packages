import type { CollectionConfig, Config, Field } from 'payload'

import { describe, expect, it } from 'vitest'

import { sitemapPlugin } from '../src/index.js'

const applyPlugin = (
  fields: Field[],
  adminFields?: { exclude?: boolean; group?: string },
): CollectionConfig => {
  // sitemapPlugin is synchronous; the Plugin type also allows Promise<Config>.
  const config = sitemapPlugin({
    adminFields,
    collections: { pages: { path: ({ doc }) => `/${doc.slug}` } },
    // `disabled` still injects fields (schema consistency) but skips everything else.
    disabled: true,
  })({ collections: [{ slug: 'pages', fields }] } as Config) as Config
  return config.collections![0]
}

const fieldNames = (fields: Field[]): string[] =>
  fields.map((field) => ('name' in field ? field.name : `<${field.type}>`))

describe('adminFields injection', () => {
  it('injects a sidebar checkbox at the collection root by default', () => {
    const collection = applyPlugin([{ name: 'title', type: 'text' }])
    expect(fieldNames(collection.fields)).toEqual(['title', 'excludeFromSitemap'])
    expect(collection.fields[1]).toMatchObject({
      type: 'checkbox',
      admin: { position: 'sidebar' },
    })
  })

  it('injects nothing when exclude is disabled, even with a group set', () => {
    const collection = applyPlugin([{ name: 'title', type: 'text' }], {
      exclude: false,
      group: 'metadata',
    })
    expect(fieldNames(collection.fields)).toEqual(['title'])
  })

  it('nests the checkbox inside an existing group field, without sidebar positioning', () => {
    const original: Field[] = [
      { name: 'metadata', type: 'group', fields: [{ name: 'description', type: 'text' }] },
    ]
    const collection = applyPlugin(original, { group: 'metadata' })

    expect(fieldNames(collection.fields)).toEqual(['metadata'])
    expect(collection.fields[0]).toMatchObject({
      type: 'group',
      fields: [
        { name: 'description' },
        { name: 'excludeFromSitemap', type: 'checkbox', label: 'Exclude from sitemap' },
      ],
    })
    const checkbox = (collection.fields[0] as { fields: Field[] }).fields[1]
    expect('admin' in checkbox ? checkbox.admin?.position : undefined).toBeUndefined()
    // The consumer's config objects are not mutated.
    expect((original[0] as { fields: Field[] }).fields).toHaveLength(1)
  })

  it('creates the group on collections that do not have it', () => {
    const collection = applyPlugin([{ name: 'title', type: 'text' }], { group: 'metadata' })
    expect(fieldNames(collection.fields)).toEqual(['title', 'metadata'])
    expect(collection.fields[1]).toMatchObject({
      name: 'metadata',
      type: 'group',
      fields: [{ name: 'excludeFromSitemap' }],
    })
  })

  it('nests inside a named tab', () => {
    const collection = applyPlugin(
      [
        {
          type: 'tabs',
          tabs: [
            { fields: [{ name: 'title', type: 'text' }], label: 'Content' },
            { name: 'metadata', fields: [{ name: 'description', type: 'text' }] },
          ],
        },
      ],
      { group: 'metadata' },
    )
    expect(collection.fields[0]).toMatchObject({
      type: 'tabs',
      tabs: [
        { fields: [{ name: 'title' }] },
        { name: 'metadata', fields: [{ name: 'description' }, { name: 'excludeFromSitemap' }] },
      ],
    })
  })

  it('finds the group inside layout-only containers', () => {
    const collection = applyPlugin(
      [
        {
          type: 'collapsible',
          fields: [
            {
              type: 'row',
              fields: [{ name: 'metadata', type: 'group', fields: [] }],
            },
          ],
          label: 'Settings',
        },
      ],
      { group: 'metadata' },
    )
    expect(collection.fields[0]).toMatchObject({
      type: 'collapsible',
      fields: [
        {
          type: 'row',
          fields: [{ name: 'metadata', fields: [{ name: 'excludeFromSitemap' }] }],
        },
      ],
    })
  })

  it('does not descend into other named groups (their data path differs)', () => {
    const collection = applyPlugin(
      [
        {
          name: 'content',
          type: 'group',
          fields: [{ name: 'metadata', type: 'group', fields: [] }],
        },
      ],
      { group: 'metadata' },
    )
    // `content.metadata` is not `metadata` — a fresh top-level group is created instead.
    expect(fieldNames(collection.fields)).toEqual(['content', 'metadata'])
    expect((collection.fields[0] as { fields: Field[] }).fields[0]).toMatchObject({ fields: [] })
  })

  it('nests via a dotted path through a named tab', () => {
    const collection = applyPlugin(
      [
        {
          type: 'tabs',
          tabs: [
            { name: 'seo', fields: [{ name: 'metadata', type: 'group', fields: [] }] },
            { name: 'metadata', fields: [] },
          ],
        },
      ],
      { group: 'seo.metadata' },
    )
    expect(collection.fields[0]).toMatchObject({
      type: 'tabs',
      tabs: [
        { name: 'seo', fields: [{ name: 'metadata', fields: [{ name: 'excludeFromSitemap' }] }] },
        // The sibling `metadata` tab does not match `seo.metadata`.
        { name: 'metadata', fields: [] },
      ],
    })
  })

  it('targets a group inside another named group via dot notation', () => {
    const collection = applyPlugin(
      [
        {
          name: 'content',
          type: 'group',
          fields: [{ name: 'metadata', type: 'group', fields: [] }],
        },
      ],
      { group: 'content.metadata' },
    )
    expect(collection.fields[0]).toMatchObject({
      name: 'content',
      fields: [{ name: 'metadata', fields: [{ name: 'excludeFromSitemap' }] }],
    })
  })

  it('creates missing tail segments inside an existing container', () => {
    const collection = applyPlugin(
      [{ name: 'metadata', type: 'group', fields: [{ name: 'description', type: 'text' }] }],
      { group: 'metadata.seo' },
    )
    expect(collection.fields[0]).toMatchObject({
      name: 'metadata',
      fields: [
        { name: 'description' },
        { name: 'seo', type: 'group', fields: [{ name: 'excludeFromSitemap' }] },
      ],
    })
  })

  it('creates the whole chain when no segment exists', () => {
    const collection = applyPlugin([{ name: 'title', type: 'text' }], { group: 'meta.seo' })
    expect(fieldNames(collection.fields)).toEqual(['title', 'meta'])
    expect(collection.fields[1]).toMatchObject({
      name: 'meta',
      type: 'group',
      fields: [{ name: 'seo', type: 'group', fields: [{ name: 'excludeFromSitemap' }] }],
    })
  })

  it('throws when the name belongs to a non-group field', () => {
    expect(() => applyPlugin([{ name: 'metadata', type: 'text' }], { group: 'metadata' })).toThrow(
      /matches a "text" field/,
    )
  })

  it('throws when a mid-path segment is a non-group field', () => {
    expect(() => applyPlugin([{ name: 'seo', type: 'text' }], { group: 'seo.metadata' })).toThrow(
      /segment "seo" matches a "text" field/,
    )
  })

  it('throws on invalid paths', () => {
    expect(() => applyPlugin([], { group: 'meta..seo' })).toThrow(/not a valid field path/)
    expect(() => applyPlugin([], { group: '.meta' })).toThrow(/not a valid field path/)
  })

  it('leaves collections not configured for the sitemap untouched', () => {
    const config = sitemapPlugin({
      adminFields: { group: 'metadata' },
      collections: { pages: { path: ({ doc }) => `/${doc.slug}` } },
      disabled: true,
    })({
      collections: [
        { slug: 'pages', fields: [] },
        { slug: 'users', fields: [{ name: 'email', type: 'text' }] },
      ],
    } as Config) as Config
    expect(fieldNames(config.collections![1].fields)).toEqual(['email'])
  })
})

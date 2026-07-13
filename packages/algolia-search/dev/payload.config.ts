import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { algoliaSearchPlugin } from '@whatworks/payload-algolia-search'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildDevConfig({
  collections: [
    {
      slug: 'pages',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'slug',
          type: 'text',
        },
        {
          name: 'internalNotes',
          type: 'textarea',
          custom: {
            algoliaSearch: false,
          },
        },
        {
          name: 'hero',
          type: 'group',
          fields: [
            {
              name: 'eyebrow',
              type: 'text',
            },
            {
              name: 'intro',
              type: 'richText',
            },
          ],
        },
        {
          name: 'pageComponents',
          type: 'blocks',
          blocks: [
            {
              slug: 'textBlock',
              fields: [
                {
                  name: 'heading',
                  type: 'text',
                },
                {
                  name: 'body',
                  type: 'richText',
                },
              ],
            },
            {
              slug: 'faq',
              fields: [
                {
                  name: 'items',
                  type: 'array',
                  fields: [
                    {
                      name: 'question',
                      type: 'text',
                    },
                    {
                      name: 'answer',
                      type: 'textarea',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      versions: {
        drafts: {
          autosave: true,
        },
      },
    },
    {
      slug: 'news',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'slug',
          type: 'text',
        },
        {
          name: 'excerpt',
          type: 'textarea',
        },
        {
          name: 'content',
          type: 'richText',
        },
      ],
      versions: {
        drafts: {
          autosave: true,
        },
      },
    },
  ],
  dbName: 'payload-algolia-search-dev',
  dirname,
  editor: lexicalEditor(),
  plugins: [
    algoliaSearchPlugin({
      algolia: {
        apiKey: process.env.ALGOLIA_ADMIN_API_KEY,
        appId: process.env.ALGOLIA_APP_ID,
        index: process.env.ALGOLIA_INDEX || 'payload-algolia-search-dev',
      },
      collections: {
        news: true,
        pages: true,
      },
      getPath: ({ collection, doc }) =>
        typeof doc.slug === 'string' && doc.slug ? `/${collection.slug}/${doc.slug}` : undefined,
    }),
  ],
})

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { searchSelectPlugin, selectSearch } from '../src/index.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const databaseURL =
  process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/payload-search-select-dev'

const fruits = [
  'Apple',
  'Apricot',
  'Avocado',
  'Banana',
  'Blackberry',
  'Blueberry',
  'Cherry',
  'Coconut',
  'Cranberry',
  'Date',
  'Fig',
  'Grape',
  'Guava',
  'Kiwi',
  'Lemon',
  'Lime',
  'Mango',
  'Orange',
  'Peach',
  'Pear',
  'Pineapple',
  'Plum',
  'Raspberry',
  'Strawberry',
  'Watermelon',
]

export default buildConfig({
  admin: {
    user: 'users',
    autoLogin: {
      email: 'dev@payloadcms.com',
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: 'users',
      auth: true,
      fields: [],
    },
    {
      slug: 'posts',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'customer',
          type: 'group',
          fields: [
            selectSearch({
              name: 'favoriteFruit',
              label: 'Favorite Fruit',
              custom: {
                searchFunction: async ({ query, limit }) => {
                  const normalized = query.trim().toLowerCase()
                  const filtered = fruits.filter((fruit) =>
                    fruit.toLowerCase().includes(normalized),
                  )
                  return filtered.slice(0, limit).map((fruit) => ({
                    label: fruit,
                    value: fruit.toLowerCase(),
                  }))
                },
              },
              admin: {
                components: {
                  Field: '@whatworks/payload-search-select-field/client#SearchSelectField',
                },
              },
            }),
          ],
        },
      ],
    },
  ],
  globals: [
    {
      slug: 'settings',
      fields: [
        selectSearch({
          name: 'primaryFruit',
          label: 'Primary Fruit',
          custom: {
            searchFunction: async ({ query, limit }) => {
              const normalized = query.trim().toLowerCase()
              const filtered = fruits.filter((fruit) =>
                fruit.toLowerCase().includes(normalized),
              )
              return filtered.slice(0, limit).map((fruit) => ({
                label: fruit,
                value: fruit.toLowerCase(),
              }))
            },
          },
          admin: {
            components: {
              Field: '@whatworks/payload-search-select-field/client#SearchSelectField',
            },
          },
        }),
      ],
    },
  ],
  db: mongooseAdapter({
    url: databaseURL,
  }),
  plugins: [searchSelectPlugin()],
  secret: process.env.PAYLOAD_SECRET || 'search-select-dev-secret',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  onInit: async (payload) => {
    const existing = await payload.find({
      collection: 'users',
      limit: 1,
    })

    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: {
          email: 'dev@payloadcms.com',
          password: 'test',
        },
      })
    }
  },
})

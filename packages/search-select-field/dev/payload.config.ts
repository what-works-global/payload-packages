import { mongooseAdapter } from '@payloadcms/db-mongodb'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { searchSelectPlugin, selectSearch } from '@whatworks/payload-search-select-field'

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

const fruitsEntries = fruits.map((fruit) => [fruit.toLowerCase(), fruit])

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
  ],
  globals: [
    {
      slug: 'example',
      fields: [
        selectSearch({
          name: 'fruits',
          label: 'Fruits',
          hasMany: true,
          searchFunction: async ({ query, selectedValues }) => {
            const normalized = query.trim().toLowerCase()
            const queryFiltered = fruitsEntries
              .filter(([value]) => value.includes(normalized))
              .slice(0, 10)
            const selectedFiltered = fruitsEntries.filter(([value]) =>
              selectedValues.includes(value),
            )
            const seen = new Set<string>()
            const combined = [...queryFiltered, ...selectedFiltered].filter(([value]) => {
              if (seen.has(value)) return false
              seen.add(value)
              return true
            })
            return combined.map(([value, label]) => ({
              label: label,
              value: value,
            }))
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

import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { selectSearchField, selectSearchPlugin } from '@whatworks/payload-select-search-field'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

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

export default buildDevConfig({
  dbName: 'payload-select-search-dev',
  dirname,
  globals: [
    {
      slug: 'example',
      fields: [
        {
          name: 'test',
          type: 'text',
        },
        selectSearchField({
          name: 'fruits',
          hasMany: true,
          label: 'Fruits',
          search: {
            watchFieldPaths: ['test'],
            searchFunction: ({ query, selectedValues }) => {
              const normalized = query.trim().toLowerCase()
              const queryFiltered = fruitsEntries
                .filter(([value]) => value.includes(normalized))
                .slice(0, 10)
              const selectedFiltered = fruitsEntries.filter(([value]) =>
                selectedValues.includes(value),
              )
              const seen = new Set<string>()
              const combined = [...queryFiltered, ...selectedFiltered].filter(([value]) => {
                if (seen.has(value)) {
                  return false
                }
                seen.add(value)
                return true
              })
              return combined.map(([value, label]) => ({
                label,
                value,
              }))
            },
          },
        }),
      ],
    },
  ],
  plugins: [selectSearchPlugin()],
})

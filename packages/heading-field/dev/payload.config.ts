import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { headingField } from '@whatworks/payload-heading-field'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const databaseURL =
  process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/payload-heading-field-dev'

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

export default buildConfig({
  admin: {
    autoLogin: {
      email: 'dev@payloadcms.com',
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: 'users',
  },
  collections: [
    {
      slug: 'users',
      auth: true,
      fields: [],
    },
    {
      slug: 'pages',
      fields: [
        // Default config: tags ['h1', 'h2', 'h3'], default 'h2'.
        headingField({
          config: {},
          field: {
            name: 'heading',
            type: 'text',
            label: 'Page heading',
            required: true,
          },
        }),
        // Custom tags + default, textarea value.
        headingField({
          config: {
            defaultTag: 'h3',
            tags: ['h2', 'h3', 'h4'],
          },
          field: {
            name: 'subheading',
            type: 'textarea',
            label: 'Sub heading',
          },
        }),
        // Rich text value rendered through the custom group field.
        headingField({
          config: {
            tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
          },
          field: {
            name: 'richHeading',
            type: 'richText',
            editor: lexicalEditor(),
            label: 'Rich heading',
          },
        }),
      ],
    },
  ],
  db: mongooseAdapter({
    url: databaseURL,
  }),
  editor: lexicalEditor(),
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
  secret: process.env.PAYLOAD_SECRET || 'heading-field-dev-secret',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

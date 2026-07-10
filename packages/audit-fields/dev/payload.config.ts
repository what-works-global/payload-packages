import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { auditFieldsPlugin } from '@whatworks/payload-audit-fields'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const databaseURL = process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/payload-audit-fields-dev'

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
          name: 'content',
          type: 'textarea',
        },
      ],
      folders: true,
      versions: {
        drafts: {
          autosave: true,
        },
      },
    },
    {
      slug: 'tags',
      admin: {
        useAsTitle: 'name',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
        },
      ],
    },
  ],
  db: mongooseAdapter({
    url: databaseURL,
  }),
  globals: [
    {
      slug: 'site-settings',
      fields: [
        {
          name: 'siteName',
          type: 'text',
        },
      ],
      versions: true,
    },
  ],
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
  plugins: [auditFieldsPlugin()],
  secret: process.env.PAYLOAD_SECRET || 'audit-fields-dev-secret',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

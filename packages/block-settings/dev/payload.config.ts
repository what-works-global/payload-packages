import path from 'path'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { blockSettingsField, blockSettingsPlugin } from '@whatworks/payload-block-settings'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const databaseURL =
  process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/payload-block-settings-dev'

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
        {
          type: 'blocks',
          name: 'components',
          blocks: [
            {
              slug: 'blockWithoutSettings',
              fields: [],
            },
            {
              slug: 'component',
              fields: [
                {
                  name: 'title',
                  type: 'text',
                },
                blockSettingsField({
                  fields: [
                    {
                      name: 'theme',
                      type: 'select',
                      defaultValue: 'light',
                      options: ['light', 'dark'],
                    },
                    {
                      name: 'anchor',
                      type: 'text',
                    },
                  ],
                  settings: {
                    canonical: true,
                    location: 'inline',
                  },
                }),
                blockSettingsField({
                  fields: [
                    {
                      name: 'variant',
                      type: 'select',
                      defaultValue: 'default',
                      options: ['default', 'featured'],
                    },
                    {
                      name: 'showBorder',
                      type: 'checkbox',
                    },
                  ],
                }),
              ],
            },
            {
              slug: 'content',
              fields: [
                blockSettingsField({
                  fields: [
                    {
                      name: 'variant',
                      type: 'select',
                      defaultValue: 'default',
                      options: ['default', 'featured'],
                    },
                    {
                      name: 'showBorder',
                      type: 'checkbox',
                    },
                  ],
                  settings: {
                    location: 'drawer',
                  },
                }),
                {
                  name: 'headline',
                  type: 'text',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  plugins: [blockSettingsPlugin()],
  db: mongooseAdapter({
    url: databaseURL,
  }),
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
  secret: process.env.PAYLOAD_SECRET || 'block-settings-dev-secret',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

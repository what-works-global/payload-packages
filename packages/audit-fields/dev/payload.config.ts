import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { auditFieldsPlugin } from '@whatworks/payload-audit-fields'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildDevConfig({
  collections: [
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
  dbName: 'payload-audit-fields-dev',
  dirname,
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
  plugins: [auditFieldsPlugin()],
})

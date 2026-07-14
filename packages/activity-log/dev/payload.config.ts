import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { activityLogPlugin } from '@whatworks/payload-activity-log'
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
      trash: true,
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
  dbName: 'payload-activity-log-dev',
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
  plugins: [
    auditFieldsPlugin(),
    activityLogPlugin({ ipAddress: true, requestHost: true, retention: { maxAgeDays: 90 } }),
  ],
})

import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { rbacPlugin } from '@whatworks/payload-rbac'
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
      versions: {
        drafts: true,
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
  dbName: 'payload-rbac-dev',
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
    },
  ],
  plugins: [
    rbacPlugin({
      adminRole: 'Super Admin',
      roles: [
        {
          name: 'Admin',
          permissions: ['*'],
          protected: true,
        },
        {
          name: 'Viewer',
          description: 'Read-only access to content.',
          permissions: ['posts:read', 'tags:read', 'site-settings:read'],
        },
      ],
    }),
  ],
})

import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { blockSettingsField, blockSettingsPlugin } from '@whatworks/payload-block-settings'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildDevConfig({
  collections: [
    {
      slug: 'pages',
      fields: [
        {
          name: 'components',
          type: 'blocks',
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
  dbName: 'payload-block-settings-dev',
  dirname,
  plugins: [blockSettingsPlugin()],
})

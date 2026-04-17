# Payload Block Settings

Hide extra fields for blocks behind a visibility toggle button.

The plugin works primarily by overriding `block.admin.components.Label` for blocks that contain a tagged `blockSettingsField()`. That custom label preserves Payload's normal block header UI and also adds the Settings button toggle.

## Usage

```ts
import { buildConfig } from 'payload'
import {
  blockSettingsField,
  blockSettingsPlugin,
} from '@whatworks/payload-block-settings'

export default buildConfig({
  collections: [
    {
      slug: 'pages',
      fields: [
        {
          name: 'components',
          type: 'blocks',
          blocks: [
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
                      options: ['light', 'dark'],
                    },
                    {
                      name: 'anchor',
                      type: 'text',
                    },
                  ],
                  settings: {
                    location: 'drawer',
                  },
                }),
                blockSettingsField({
                  fields: [
                    {
                      name: 'variant',
                      type: 'select',
                      options: ['default', 'featured'],
                    },
                  ],
                  settings: {
                    canonical: true,
                    location: 'inline',
                  },
                }),
              ],
            },
          ],
        },
      ],
    },
  ],
  plugins: [blockSettingsPlugin()],
})
```

## Notes
- `settings.location` defaults to `'inline'`. When set to `'drawer'`, the Settings button opens a drawer. When set to `'inline'`, the Settings button toggles the settings group open and closed inside the block body.
- Multiple `blockSettingsField()` calls on the same block are merged into one real settings group during plugin initialization. If two merged top-level settings fields have the same `name`, the plugin throws an error. When groups are merged, the first tagged settings field becomes the canonical stored group unless one field is declared with `settings: { canonical: true }`, in which case that field becomes the source of truth. If more than one tagged settings field is marked `settings: { canonical: true }`, the plugin throws an error.
- The default settings field name is `settings`.
- The merged settings group is always moved to the first position in the block's `fields` array.
- The plugin always overrides `block.admin.components.Label` for blocks that use `blockSettingsField()`. If you already have a custom block label, this plugin needs to own that extension point or be composed into your existing label implementation.

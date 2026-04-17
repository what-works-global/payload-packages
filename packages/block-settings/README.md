# Payload Block Settings

Payload plugin for rendering a block-level settings drawer from a custom block header label.

## How it works

1. Define one or more hidden named groups on a block with `blockSettingsField()`.
2. Install `blockSettingsPlugin()` in your Payload config.
3. The plugin finds blocks with that tagged settings group and injects a custom `admin.components.Label`.
4. That label preserves the normal block header UI and adds a cog button.
5. Clicking the cog toggles the visibility of the hidden fields

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

Multiple `blockSettingsField()` calls on the same block are merged into one real settings group during plugin initialization. If two merged top-level settings fields have the same `name`, the plugin throws an error. When groups are merged, the first tagged settings field becomes the canonical stored group unless one field is declared with `settings: { canonical: true }`, in which case that field becomes the source of truth. If more than one tagged settings field is marked `settings: { canonical: true }`, the plugin throws an error.

`settings.location` defaults to `'inline'`. When set to `'drawer'`, the Settings button opens a drawer. When set to `'inline'`, the Settings button toggles the settings group open and closed inside the block body.

## Notes

- The default settings field name is `settings`.
- The merged settings group is always moved to the first position in the block's `fields` array.
- By default the plugin does not overwrite an existing `block.admin.components.Label`.

# Payload Block Settings

Proof-of-concept Payload plugin for rendering a block-level settings drawer from a custom block header label.

## How it works

1. Define one or more hidden named groups on a block with `blockSettingsField()`.
2. Install `blockSettingsPlugin()` in your Payload config.
3. The plugin finds blocks with that tagged settings group and injects a custom `admin.components.Label`.
4. That label preserves the normal block header UI and adds a cog button.
5. Clicking the cog opens a drawer that renders the merged settings group fields at the correct form path.

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
                }),
                blockSettingsField({
                  fields: [
                    {
                      name: 'variant',
                      type: 'select',
                      options: ['default', 'featured'],
                    },
                  ],
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

Multiple `blockSettingsField()` calls on the same block are merged into one real settings group during plugin initialization. If two merged top-level settings fields have the same `name`, the plugin throws an error. When groups are merged, the first tagged settings field becomes the canonical stored group and the later tagged groups are folded into it.

## Notes

- The helper uses `hidden: true`, so the settings group does not render in the normal block body.
- The default settings field name is `settings`.
- By default the plugin does not overwrite an existing `block.admin.components.Label`.

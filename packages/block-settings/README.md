# Payload Block Settings

Proof-of-concept Payload plugin for rendering a block-level settings drawer from a custom block header label.

## How it works

1. Define a hidden named group on a block with `blockSettingsGroup()`.
2. Install `blockSettingsPlugin()` in your Payload config.
3. The plugin finds blocks with that tagged settings group and injects a custom `admin.components.Label`.
4. That label preserves the normal block header UI and adds a cog button.
5. Clicking the cog opens a drawer that renders the settings group fields at the correct form path.

## Usage

```ts
import { buildConfig } from 'payload'
import {
  blockSettingsGroup,
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
                blockSettingsGroup({
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

- The helper uses `hidden: true`, so the settings group does not render in the normal block body.
- The default settings field name is `settings`.
- If you change the group name, pass the same `settingsFieldName` to `blockSettingsPlugin({ settingsFieldName })`.
- By default the plugin does not overwrite an existing `block.admin.components.Label`.

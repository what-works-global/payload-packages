# Payload Block Settings Plugin

Hide extra fields for blocks behind a visibility toggle button.

Works by overriding `block.admin.components.Label` for blocks that contain a tagged `blockSettingsField()`. The custom label preserves Payload's normal block header UI but also adds the Settings button toggle.

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

## Arguments

`blockSettingsField()` accepts normal Payload `GroupField` args. The only plugin-specific top-level addition is `settings`, which controls how that group participates in block settings behavior.

### `settings` object

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `canonical` | `boolean` | `false` | Marks this settings group as the canonical source of truth when multiple `blockSettingsField()` calls exist on the same block. More than one canonical settings group throws an error. |
| `location` | `'inline' \| 'drawer'` | `'inline'` | Controls whether the Settings button toggles the fields inline inside the block body or opens them in a drawer. |

## Notes
- Multiple `blockSettingsField()` calls on the same block are merged into one real settings group during plugin initialization. If two merged top-level settings fields have the same `name`, the plugin throws an error. When groups are merged, the first tagged settings field becomes the canonical stored group unless one field is declared with `settings: { canonical: true }`, in which case that field becomes the source of truth. If more than one tagged settings field is marked `settings: { canonical: true }`, the plugin throws an error.
- The default settings field name is `settings`.
- The merged settings group field is always moved to the first position in the block's `fields` array.
- The plugin always overrides `block.admin.components.Label` for blocks that use `blockSettingsField()`.

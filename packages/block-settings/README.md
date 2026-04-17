# Payload Block Settings Plugin


<a href="https://whatworks.com.au/?utm_source=github">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Payload Block Settings Plugin" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Hide extra fields for blocks behind a visibility toggle button.

## Demo
  
[demo.mov](https://github.com/user-attachments/assets/f4671529-9455-454d-95b1-455040448783)

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [Arguments](#arguments)
  - [`settings` object](#settings-object)
- [Using a custom Label](#using-a-custom-label)
  - [Add actions alongside the default label](#add-actions-alongside-the-default-label)
  - [Build a label from scratch](#build-a-label-from-scratch)
- [Notes](#notes)

## Installation

```bash
pnpm add @whatworks/payload-block-settings
```

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

## Using a custom Label

The plugin replaces `block.admin.components.Label` with `BlockSettingsLabel` on any block that uses `blockSettingsField()`. To customize, point the block's Label at your own component — include `BlockSettingsToggleButton` so the settings toggle still renders.

```ts
{
  slug: 'component',
  admin: {
    components: {
      Label: '/path/to/MyBlockLabel#MyBlockLabel',
    },
  },
  fields: [/* ... */],
}
```

### Add actions alongside the default label

Use `BlockLabelWithActions` to keep Payload's default row header and append extra buttons next to the settings toggle.

```tsx
'use client'

import {
  BlockLabelWithActions,
  BlockSettingsToggleButton,
  useBlockLabelState,
  type BlockLabelActionComponent,
} from '@whatworks/payload-block-settings/client'

const MyCustomActionButton: BlockLabelActionComponent = (props) => {
  const { path } = useBlockLabelState(props)
  return <button onClick={() => console.log('duplicate', path)}>⧉</button>
}

export const MyBlockLabel: BlockLabelActionComponent = (props) => (
  <BlockLabelWithActions
    {...props}
    actions={[BlockSettingsToggleButton, MyCustomActionButton]}
  />
)
```

### Build a label from scratch

For full control over markup, skip `BlockLabelWithActions` and read row state directly from `useBlockLabelState`. Render `BlockSettingsToggleButton` anywhere inside.

```tsx
'use client'

import {
  BlockSettingsToggleButton,
  useBlockLabelState,
  type BlockLabelActionComponent,
} from '@whatworks/payload-block-settings/client'

export const MyBlockLabel: BlockLabelActionComponent = (props) => {
  const { block, resolvedRowNumber, rowLabel } = useBlockLabelState(props)

  return (
    <div className="my-block-label">
      <span>#{resolvedRowNumber}</span>
      <strong>{rowLabel}</strong>
      <small>{block?.slug}</small>
      <BlockSettingsToggleButton {...props} />
    </div>
  )
}
```

## Notes
- Multiple `blockSettingsField()` calls on the same block are merged into one real settings group during plugin initialization. If two merged top-level settings fields have the same `name`, the plugin throws an error. When groups are merged, the first tagged settings field becomes the canonical stored group unless one field is declared with `settings: { canonical: true }`, in which case that field becomes the source of truth. If more than one tagged settings field is marked `settings: { canonical: true }`, the plugin throws an error.
- The default settings field name is `settings`.
- The merged settings group field is always moved to the first position in the block's `fields` array.
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { headingField } from '@whatworks/payload-heading-field'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildDevConfig({
  collections: [
    {
      slug: 'pages',
      fields: [
        // Default config: tags ['h1', 'h2', 'h3', 'h4', 'h5'], default 'h2'.
        headingField({
          name: 'heading',
          type: 'text',
          label: 'Page heading',
          required: true,
        }),
        // Custom tags + default, textarea value.
        headingField(
          {
            name: 'subheading',
            type: 'textarea',
            label: 'Sub heading',
          },
          {
            defaultTag: 'h3',
            tags: ['h2', 'h3', 'h4'],
          },
        ),
        // Rich text value rendered through the custom group field.
        headingField(
          {
            name: 'richHeading',
            type: 'richText',
            editor: lexicalEditor(),
            label: 'Rich heading',
          },
          {
            tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
          },
        ),
      ],
    },
  ],
  dbName: 'payload-heading-field-dev',
  dirname,
  editor: lexicalEditor(),
})

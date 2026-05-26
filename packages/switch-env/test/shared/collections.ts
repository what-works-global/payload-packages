import type { CollectionConfig, GlobalConfig } from 'payload'

// Returned as factories because Payload's buildConfig mutates the array
// (notably by appending payload-kv) — sharing one reference between the source
// and target configs would trip a DuplicateCollection error.
export const buildSharedCollections = (): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'body', type: 'textarea' },
      { name: 'author', type: 'relationship', relationTo: 'authors' },
    ],
    versions: { drafts: true },
  },
  {
    slug: 'authors',
    fields: [{ name: 'name', type: 'text', required: true }],
  },
  {
    slug: 'kitchen-sink',
    fields: [
      { name: 'textField', type: 'text' },
      { name: 'textareaField', type: 'textarea' },
      { name: 'emailField', type: 'email' },
      { name: 'codeField', type: 'code' },
      { name: 'numberField', type: 'number' },
      { name: 'checkboxField', type: 'checkbox' },
      { name: 'dateField', type: 'date' },
      { name: 'jsonField', type: 'json' },
      {
        name: 'selectField',
        type: 'select',
        options: [
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta' },
          { label: 'Gamma', value: 'gamma' },
        ],
      },
      {
        name: 'selectManyField',
        type: 'select',
        hasMany: true,
        options: [
          { label: 'Red', value: 'red' },
          { label: 'Green', value: 'green' },
          { label: 'Blue', value: 'blue' },
        ],
      },
      {
        name: 'radioField',
        type: 'radio',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
      },
      {
        name: 'arrayField',
        type: 'array',
        fields: [
          { name: 'itemText', type: 'text' },
          { name: 'itemNumber', type: 'number' },
        ],
      },
      {
        name: 'blocksField',
        type: 'blocks',
        blocks: [
          {
            slug: 'heroBlock',
            fields: [
              { name: 'heading', type: 'text' },
              { name: 'subheading', type: 'text' },
            ],
          },
          {
            slug: 'quoteBlock',
            fields: [
              { name: 'quote', type: 'textarea' },
              { name: 'attribution', type: 'text' },
            ],
          },
        ],
      },
      {
        name: 'groupField',
        type: 'group',
        fields: [
          { name: 'groupText', type: 'text' },
          { name: 'groupNumber', type: 'number' },
        ],
      },
      { name: 'singleRel', type: 'relationship', relationTo: 'authors' },
      {
        name: 'manyRel',
        type: 'relationship',
        hasMany: true,
        relationTo: 'authors',
      },
      { name: 'richTextField', type: 'richText' },
    ],
  },
]

export const buildSharedGlobals = (): GlobalConfig[] => [
  {
    slug: 'site-settings',
    fields: [
      { name: 'siteName', type: 'text' },
      { name: 'tagline', type: 'text' },
    ],
  },
]

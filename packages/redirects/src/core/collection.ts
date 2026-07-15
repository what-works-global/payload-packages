import type { CollectionConfig, CollectionSlug, Field, TextField, ValidateOptions } from 'payload'

import type { ResolvedRedirectsConfig } from '../types.js'

import { normalizeRedirectFrom, normalizeScrollTo } from './shared.js'

const redirectTypeOptions = [
  {
    label: '301 - Permanent',
    value: '301',
  },
  {
    label: '302 - Temporary',
    value: '302',
  },
] as const

export const validateUrlOrPathname = (value: null | string | undefined): string | true => {
  const requiredMessage = 'This field is required'

  if (!value) {
    return requiredMessage
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return requiredMessage
  }

  const isPathname = /^\/\S*$/.test(trimmed)
  if (isPathname) {
    return true
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return true
    }

    return 'Invalid URL or pathname'
  } catch {
    return 'Invalid URL or pathname'
  }
}

export const validateFromField = (
  value: null | string | undefined,
  options: ValidateOptions<unknown, { useRegex?: boolean | null }, TextField, string>,
): string | true => {
  const trimmed = value?.trim()

  if (!options.siblingData?.useRegex) {
    return validateUrlOrPathname(trimmed)
  }

  if (!trimmed) {
    return 'This field is required'
  }

  try {
    new RegExp(trimmed)
    return true
  } catch {
    return 'Invalid regular expression'
  }
}

export const validateScrollTo = (value: null | string | undefined): string | true => {
  if (!value) {
    return true
  }
  if (/\s/.test(normalizeScrollTo(value))) {
    return 'Element ids cannot contain whitespace'
  }
  return true
}

export const buildRedirectsCollection = (config: ResolvedRedirectsConfig): CollectionConfig => {
  const referenceSlugs = Object.keys(config.collections)
  const hasReferences = referenceSlugs.length > 0

  const toFields: Field[] = []

  if (hasReferences) {
    toFields.push(
      {
        name: 'type',
        type: 'radio',
        admin: {
          layout: 'horizontal',
        },
        defaultValue: 'reference',
        label: 'To URL Type',
        options: [
          {
            label: 'Internal Link',
            value: 'reference',
          },
          {
            label: 'Custom URL',
            value: 'custom',
          },
        ],
      },
      {
        name: 'reference',
        type: 'relationship',
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'reference',
        },
        label: 'Document To Redirect To',
        // The assertion only matters in consumer projects, where generated types
        // narrow CollectionSlug from string to a union of known slugs.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        relationTo: referenceSlugs as CollectionSlug[],
        required: true,
      },
    )
  }

  toFields.push(
    {
      name: 'url',
      type: 'text',
      ...(hasReferences
        ? {
            admin: {
              condition: (_, siblingData) => siblingData?.type === 'custom',
            },
          }
        : {}),
      label: 'Custom URL',
      required: true,
      validate: validateUrlOrPathname,
    },
    {
      name: 'scrollTo',
      type: 'text',
      admin: {
        description:
          'Optional id of an element on the destination page — appended to the redirect as a #fragment.',
      },
      label: 'Scroll To Element',
      validate: validateScrollTo,
    },
  )

  return {
    slug: config.slug,
    admin: {
      defaultColumns: [
        'from',
        hasReferences ? 'to.type' : 'to.url',
        ...(config.hits ? ['hits', 'lastAccess'] : []),
        'createdAt',
      ],
      group: 'Plugin',
      useAsTitle: 'from',
    },
    fields: [
      {
        name: 'from',
        type: 'text',
        hooks: {
          beforeChange: [
            ({ siblingData, value }) => {
              if (typeof value !== 'string') {
                return value
              }

              const trimmed = value.trim()

              if (siblingData?.useRegex) {
                return trimmed
              }

              return normalizeRedirectFrom(trimmed)
            },
          ],
        },
        index: true,
        label: 'From URL',
        required: true,
        unique: true,
        validate: validateFromField,
      },
      {
        name: 'useRegex',
        type: 'checkbox',
        admin: {
          description:
            'Match the request path against a regular expression. Capture groups can be used in a custom destination URL as $1, $2, …',
        },
        defaultValue: false,
        label: 'Use Regex',
      },
      {
        name: 'to',
        type: 'group',
        fields: toFields,
        label: false,
      },
      {
        name: 'type',
        type: 'select',
        defaultValue: '301',
        label: 'Redirect Type',
        options: [...redirectTypeOptions],
        required: true,
      },
      ...(config.hits
        ? ([
            {
              name: 'hits',
              type: 'number',
              admin: {
                position: 'sidebar',
                readOnly: true,
              },
              defaultValue: 0,
              label: 'Hits',
              required: true,
            },
            {
              name: 'lastAccess',
              type: 'date',
              admin: {
                date: {
                  displayFormat: 'yyyy-MM-dd hh:mm a',
                  pickerAppearance: 'dayAndTime',
                },
                position: 'sidebar',
                readOnly: true,
              },
              label: 'Last Access',
            },
          ] satisfies Field[])
        : []),
    ],
    orderable: true,
  }
}

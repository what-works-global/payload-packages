import type {
  CheckboxField,
  CollectionConfig,
  CollectionSlug,
  Field,
  SelectField,
  TextField,
  UIField,
  ValidateOptions,
} from 'payload'

import type { ResolvedRedirectsConfig } from '../types.js'

import { normalizeRedirectFrom, normalizeScrollTo } from './shared.js'

/**
 * Import-map path of the destination list cell (`RedirectDestinationCell`).
 * Referenced only as a string so the React component never enters the plugin's
 * server/edge bundles; consumers register it by regenerating their admin import
 * map (`payload generate:importmap`), which resolves the `./rsc` export.
 */
const destinationCellPath = '@whatworks/payload-redirects/rsc#RedirectDestinationCell'

const redirectStatusOptions = [
  {
    label: '301 - Permanent',
    value: '301',
  },
  {
    label: '302 - Temporary',
    value: '302',
  },
] as const

const matchTypeOptions = [
  { label: 'Exact', value: 'exact' },
  { label: 'Starts with', value: 'startsWith' },
  { label: 'Ends with', value: 'endsWith' },
  { label: 'Contains', value: 'contains' },
  { label: 'Regex', value: 'regex' },
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

/**
 * Save-time validator for regex `from` patterns. Conservatively rejects shapes
 * that are prone to catastrophic backtracking — this is a static structural
 * check, not a runtime ReDoS guard. Exotic patterns may need restructuring.
 * Returns `true`, or a human-readable error string.
 */
export const validateSafeRegexPattern = (pattern: string): string | true => {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    return 'This field is required'
  }

  if (pattern.length > 256) {
    return 'Regular expression is too long (maximum 256 characters).'
  }

  try {
    new RegExp(pattern)
  } catch {
    return 'Invalid regular expression'
  }

  const catastrophic =
    'This pattern can cause catastrophic backtracking (an unbounded quantifier applied to a group that already repeats unboundedly). Restructure it to be safe.'
  const boundedTooLarge = 'Bounded repetition above 1000 is not allowed.'

  let inClass = false
  const groupStack: { hasUnbounded: boolean }[] = []
  // Whether the most recently closed group contained an unbounded quantifier;
  // only meaningful for a quantifier that immediately follows a `)`.
  let lastClosedGroupHadUnbounded = false

  const markUnbounded = () => {
    const current = groupStack[groupStack.length - 1]
    if (current) {
      current.hasUnbounded = true
    }
  }

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]

    if (char === '\\') {
      const next = pattern[i + 1]
      if (!inClass && next !== undefined && next >= '1' && next <= '9') {
        return 'Backreferences are not supported in redirect patterns.'
      }
      i++ // skip the escaped character
      lastClosedGroupHadUnbounded = false
      continue
    }

    if (inClass) {
      if (char === ']') {
        inClass = false
      }
      lastClosedGroupHadUnbounded = false
      continue
    }

    if (char === '[') {
      inClass = true
      lastClosedGroupHadUnbounded = false
      continue
    }

    if (char === '(') {
      groupStack.push({ hasUnbounded: false })
      lastClosedGroupHadUnbounded = false
      continue
    }

    if (char === ')') {
      const closed = groupStack.pop()
      const hadUnbounded = closed ? closed.hasUnbounded : false
      // Bubble "contains an unbounded quantifier at any depth" up to the parent.
      if (hadUnbounded) {
        markUnbounded()
      }
      lastClosedGroupHadUnbounded = hadUnbounded
      continue
    }

    if (char === '*' || char === '+') {
      if (lastClosedGroupHadUnbounded) {
        return catastrophic
      }
      markUnbounded()
      lastClosedGroupHadUnbounded = false
      continue
    }

    if (char === '{') {
      const quantifier = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i))
      if (quantifier) {
        const min = Number(quantifier[1])
        const hasComma = quantifier[2] !== undefined
        const maxRaw = quantifier[3]
        const isUnbounded = hasComma && (maxRaw === undefined || maxRaw === '')
        const max = maxRaw ? Number(maxRaw) : undefined

        if (!hasComma && min > 1000) {
          return boundedTooLarge
        }
        if (!isUnbounded && max !== undefined && max > 1000) {
          return boundedTooLarge
        }

        if (isUnbounded) {
          if (lastClosedGroupHadUnbounded) {
            return catastrophic
          }
          markUnbounded()
        }

        i += quantifier[0].length - 1
        lastClosedGroupHadUnbounded = false
        continue
      }
    }

    lastClosedGroupHadUnbounded = false
  }

  return true
}

export const validateFromField = (
  value: null | string | undefined,
  options: ValidateOptions<unknown, { matchType?: null | string }, TextField, string>,
): string | true => {
  const trimmed = value?.trim()
  const matchType = options.siblingData?.matchType ?? 'exact'

  if (matchType === 'regex') {
    if (!trimmed) {
      return 'This field is required'
    }
    return validateSafeRegexPattern(trimmed)
  }

  if (matchType === 'exact') {
    return validateUrlOrPathname(trimmed)
  }

  // startsWith / endsWith / contains: any non-empty substring is valid.
  if (!trimmed) {
    return 'This field is required'
  }
  return true
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

/** True when advanced settings are on, or the field already holds a non-default value. */
const showWhenAdvancedOr = (
  hasValue: (data: Record<string, unknown>) => boolean,
): ((data: unknown) => boolean) => {
  return (data) => {
    const record = (data ?? {}) as Record<string, unknown>
    return record.advanced === true || hasValue(record)
  }
}

export const buildRedirectsCollection = (config: ResolvedRedirectsConfig): CollectionConfig => {
  const referenceSlugs = Object.keys(config.collections)
  const hasReferences = referenceSlugs.length > 0
  const localized = config.localized

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
        condition: (data, siblingData) =>
          (data as Record<string, unknown>)?.advanced === true ||
          Boolean((siblingData as Record<string, unknown>)?.scrollTo),
        description:
          'Optional id of an element on the destination page — appended to the redirect as a #fragment.',
      },
      label: 'Scroll To Element',
      validate: validateScrollTo,
    },
  )

  const advancedField: CheckboxField = {
    name: 'advanced',
    type: 'checkbox',
    admin: {
      description: 'Reveal matching, query, and metadata options for this redirect.',
      position: 'sidebar',
    },
    defaultValue: false,
    label: 'Show advanced settings',
  }

  const matchTypeField: SelectField = {
    name: 'matchType',
    type: 'select',
    admin: {
      condition: showWhenAdvancedOr(
        (data) => Boolean(data.matchType) && data.matchType !== 'exact',
      ),
      description:
        'How the request path is compared to "From". Exact is the common case; Regex is for advanced users (capture groups become $1, $2, … in a custom destination).',
    },
    defaultValue: 'exact',
    label: 'Match Type',
    options: [...matchTypeOptions],
    required: true,
  }

  const caseInsensitiveField: CheckboxField = {
    name: 'caseInsensitive',
    type: 'checkbox',
    admin: {
      condition: showWhenAdvancedOr((data) => data.caseInsensitive === true),
      description: 'Match the request path regardless of letter case.',
    },
    defaultValue: false,
    label: 'Case insensitive',
  }

  const forwardQueryField: CheckboxField = {
    name: 'forwardQuery',
    type: 'checkbox',
    admin: {
      condition: showWhenAdvancedOr((data) => data.forwardQuery === true),
      description:
        'Append the incoming query string to the destination (params already on the destination win).',
    },
    defaultValue: false,
    label: 'Forward query string',
  }

  const notesField: Field = {
    name: 'notes',
    type: 'textarea',
    admin: {
      condition: showWhenAdvancedOr((data) => Boolean(data.notes)),
      description: 'Internal notes for editors — why does this redirect exist?',
    },
    label: 'Notes',
  }

  // Read-only list column that renders the resolved destination: an internal
  // reference as its document path (linked to the doc in the admin), or a custom
  // URL linked externally. Data-less `ui` field — it only carries the Cell and
  // does not appear on the edit form.
  const destinationField: UIField = {
    name: 'destination',
    type: 'ui',
    admin: {
      components: {
        Cell: destinationCellPath,
      },
    },
    label: 'To',
  }

  return {
    slug: config.slug,
    admin: {
      defaultColumns: [
        'from',
        'destination',
        'enabled',
        ...(config.trackHits ? ['hits', 'lastAccess'] : []),
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
              const matchType =
                (siblingData as { matchType?: unknown } | undefined)?.matchType ?? 'exact'

              // Non-exact match types are substrings/patterns — canonicalizing
              // them (e.g. stripping a trailing slash) would break intent.
              if (matchType !== 'exact') {
                return trimmed
              }

              return normalizeRedirectFrom(trimmed)
            },
          ],
        },
        index: true,
        ...(localized ? { localized: true } : {}),
        label: 'From URL',
        required: true,
        // Unique per locale when localized (Payload scopes the unique index by locale).
        unique: true,
        validate: validateFromField,
      },
      matchTypeField,
      caseInsensitiveField,
      forwardQueryField,
      {
        name: 'to',
        type: 'group',
        fields: toFields,
        label: false,
        ...(localized ? { localized: true } : {}),
      },
      destinationField,
      {
        name: 'status',
        type: 'select',
        admin: {
          condition: showWhenAdvancedOr((data) => data.status === '302'),
        },
        defaultValue: '301',
        label: 'Redirect Type',
        options: [...redirectStatusOptions],
        required: true,
      },
      notesField,
      advancedField,
      {
        name: 'enabled',
        type: 'checkbox',
        admin: {
          description: 'Disabled redirects are kept but excluded from the live cache.',
          position: 'sidebar',
        },
        defaultValue: true,
        label: 'Enabled',
      },
      ...(config.trackHits
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

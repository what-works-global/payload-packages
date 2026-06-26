import type { ClientField, Field, GroupField } from 'payload'

import type { HeadingTag } from './types.js'

type NamedGroupField = Extract<GroupField, { name: string }>

/** Marks a group as a heading field so the matcher/UI can recognise it. */
export const HEADING_FIELD_CUSTOM_KEY = 'headingField'
/** Stores the selectable tags on the group's `admin.custom` for the client UI. */
export const HEADING_TAGS_CUSTOM_KEY = 'headingTags'
/** Stores a custom tooltip string on the group's `admin.custom` for the client UI. */
export const HEADING_TOOLTIP_CUSTOM_KEY = 'headingTooltip'

/** Sub-field names inside the generated group. */
export const HEADING_TAG_FIELD_NAME = 'tag'
export const HEADING_VALUE_FIELD_NAME = 'value'

export const DEFAULT_HEADING_TAGS: readonly HeadingTag[] = ['h1', 'h2', 'h3', 'h4', 'h5']
export const DEFAULT_HEADING_TAG: HeadingTag = 'h2'

export const ALL_HEADING_TAGS: readonly HeadingTag[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

/** Type guard: does this field config come from `headingField()`? */
export const headingFieldMatches = (field: ClientField | Field): field is NamedGroupField => {
  if (!('name' in field) || field.type !== 'group') {
    return false
  }

  return Boolean(field.admin?.custom?.[HEADING_FIELD_CUSTOM_KEY])
}

/** Reads the configured tags off a heading group field, falling back to the defaults. */
export const getHeadingTags = (field: {
  admin?: { custom?: Record<string, unknown> } | null
}): HeadingTag[] => {
  const stored = field.admin?.custom?.[HEADING_TAGS_CUSTOM_KEY]

  if (Array.isArray(stored) && stored.length > 0) {
    return stored.filter((tag): tag is HeadingTag =>
      (ALL_HEADING_TAGS as readonly string[]).includes(tag),
    )
  }

  return [...DEFAULT_HEADING_TAGS]
}

/** Reads a configured tooltip off a heading group field, if one was set. */
export const getHeadingTooltip = (field: {
  admin?: { custom?: Record<string, unknown> } | null
}): string | undefined => {
  const stored = field.admin?.custom?.[HEADING_TOOLTIP_CUSTOM_KEY]

  return typeof stored === 'string' ? stored : undefined
}

/**
 * Coerces a stored value into the canonical heading shape (`{ tag, value }`).
 *
 * This is what makes `headingField()` a drop-in replacement for a bare `text`,
 * `textarea`, or `richText` field: documents saved before the wrap hold the raw
 * value (a string, or a Lexical editor state like `{ root: … }`) directly under
 * the field name, not a `{ tag, value }` group. The group's read/validate hooks
 * run this so that legacy data is lifted into `value` (with the default tag)
 * instead of being dropped — or failing the required-`tag` validation on save.
 *
 * Pass-through (returned untouched):
 * - `null` / `undefined` — no data; the field's own defaults apply.
 * - Payload's empty-group placeholder `{}` — likewise, defaults apply.
 * - Anything already in heading shape (an object carrying a `tag` or `value`
 *   key) — never re-wrapped, so saved documents are left exactly as they are.
 *
 * Everything else (a string, a `{ root }` editor state, a number, …) is treated
 * as a legacy value and wrapped as `{ tag: defaultTag, value }`.
 */
export const normalizeHeadingValue = (value: unknown, defaultTag: HeadingTag): unknown => {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    // Already a heading group, or Payload's empty-group placeholder — leave it.
    if (HEADING_TAG_FIELD_NAME in value || HEADING_VALUE_FIELD_NAME in value) {
      return value
    }

    if (Object.keys(value).length === 0) {
      return value
    }
  }

  // Legacy value stored directly under the field name before it was wrapped.
  return { [HEADING_TAG_FIELD_NAME]: defaultTag, [HEADING_VALUE_FIELD_NAME]: value }
}

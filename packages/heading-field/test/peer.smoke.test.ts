import type { GroupField } from 'payload'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HEADING_TAG,
  DEFAULT_HEADING_TAGS,
  getHeadingTags,
  getHeadingTooltip,
  HEADING_TAGS_CUSTOM_KEY,
  headingField,
  headingFieldMatches,
  normalizeHeadingValue,
} from '../src/index.js'

const getNamedSubField = (field: GroupField, name: string) =>
  field.fields.find((child) => 'name' in child && child.name === name)

// Invoke a field hook with only the `value` it actually reads.
const runHook = (hook: unknown, value: unknown) =>
  (hook as (args: { value: unknown }) => unknown)({ value })

describe('@whatworks/payload-heading-field peer smoke', () => {
  it('headingField() returns a named group field with tag + value sub-fields', () => {
    const field = headingField({ name: 'heading', type: 'text' })

    expect(field.type).toBe('group')
    expect('name' in field && field.name).toBe('heading')

    const tag = getNamedSubField(field, 'tag')
    const value = getNamedSubField(field, 'value')

    expect(tag?.type).toBe('select')
    expect(value?.type).toBe('text')
  })

  it('marks the group and stores the configured tags so the matcher recognises it', () => {
    const field = headingField(
      { name: 'heading', type: 'text' },
      { defaultTag: 'h3', tags: ['h2', 'h3', 'h4'] },
    )

    expect(headingFieldMatches(field)).toBe(true)
    expect(field.admin?.custom?.[HEADING_TAGS_CUSTOM_KEY]).toEqual(['h2', 'h3', 'h4'])
    expect(getHeadingTags(field)).toEqual(['h2', 'h3', 'h4'])
  })

  it('defaults to the documented tags and default tag', () => {
    const field = headingField({ name: 'heading', type: 'text' })
    const tag = getNamedSubField(field, 'tag')

    expect(getHeadingTags(field)).toEqual([...DEFAULT_HEADING_TAGS])
    expect(tag && 'defaultValue' in tag && tag.defaultValue).toBe(DEFAULT_HEADING_TAG)
    expect(tag && 'required' in tag && tag.required).toBe(true)
  })

  it('wires the custom Field component and hides the inner value label', () => {
    const field = headingField({ name: 'heading', type: 'text' })
    const value = getNamedSubField(field, 'value')

    expect(field.admin?.components?.Field).toBe(
      '@whatworks/payload-heading-field/client#HeadingGroupField',
    )
    expect(value && 'label' in value && value.label).toBe(false)
  })

  it('lifts a custom Label onto the group and off the value field', () => {
    const field = headingField({
      name: 'heading',
      type: 'text',
      admin: {
        components: {
          beforeInput: ['./BeforeInput#BeforeInput'],
          Label: './MyLabel#MyLabel',
        },
      },
    })

    const value = getNamedSubField(field, 'value')
    const valueComponents = (value as { admin?: { components?: Record<string, unknown> } }).admin
      ?.components

    // The Label is rendered by the group header, so it moves to the group.
    expect(field.admin?.components?.Label).toBe('./MyLabel#MyLabel')
    // ...and is removed from the value field to avoid a duplicate render.
    expect(valueComponents?.Label).toBeUndefined()
    // Other components (rendered around the input) stay with the value field.
    expect(valueComponents?.beforeInput).toEqual(['./BeforeInput#BeforeInput'])
  })

  it('stores a configured tooltip so the UI can read it', () => {
    const field = headingField(
      { name: 'heading', type: 'text' },
      { tooltip: 'Pick the heading level for SEO.' },
    )

    expect(getHeadingTooltip(field)).toBe('Pick the heading level for SEO.')
  })

  it('omits the tooltip key when none is configured (built-in default applies)', () => {
    const field = headingField({ name: 'heading', type: 'text' })

    expect(getHeadingTooltip(field)).toBeUndefined()
  })

  it('throws when the default tag is not part of the available tags', () => {
    expect(() =>
      headingField({ name: 'heading', type: 'text' }, { defaultTag: 'h1', tags: ['h2', 'h3'] }),
    ).toThrow(/defaultTag/)
  })

  it('throws when an unknown tag is supplied', () => {
    expect(() =>
      headingField(
        { name: 'heading', type: 'text' },
        // @ts-expect-error - exercising runtime validation with an invalid tag
        { tags: ['h7'] },
      ),
    ).toThrow(/invalid tag/)
  })
})

describe('normalizeHeadingValue (backwards compatibility)', () => {
  it('wraps a legacy text/textarea string under value with the default tag', () => {
    expect(normalizeHeadingValue('Welcome', 'h2')).toEqual({ tag: 'h2', value: 'Welcome' })
    // Empty strings are still content as far as the field is concerned.
    expect(normalizeHeadingValue('', 'h3')).toEqual({ tag: 'h3', value: '' })
  })

  it('wraps a legacy richText editor state under value with the default tag', () => {
    const state = { root: { type: 'root', children: [] } }

    expect(normalizeHeadingValue(state, 'h1')).toEqual({ tag: 'h1', value: state })
  })

  it('leaves an already-normalized heading value untouched', () => {
    const stored = { tag: 'h4', value: 'Already migrated' }

    // Same reference back — saved documents are never re-wrapped or cloned.
    expect(normalizeHeadingValue(stored, 'h2')).toBe(stored)
  })

  it('treats a value-only object as already-shaped (tag default fills in later)', () => {
    const stored = { value: 'No tag yet' }

    expect(normalizeHeadingValue(stored, 'h2')).toBe(stored)
  })

  it('passes through null, undefined, and the empty-group placeholder', () => {
    expect(normalizeHeadingValue(null, 'h2')).toBeNull()
    expect(normalizeHeadingValue(undefined, 'h2')).toBeUndefined()

    const empty = {}
    expect(normalizeHeadingValue(empty, 'h2')).toBe(empty)
  })

  it('wires afterRead + beforeValidate hooks that coerce legacy data', () => {
    const field = headingField(
      { name: 'heading', type: 'text' },
      { defaultTag: 'h3', tags: ['h2', 'h3', 'h4'] },
    )

    const afterRead = field.hooks?.afterRead?.[0]
    const beforeValidate = field.hooks?.beforeValidate?.[0]

    expect(afterRead).toBeTypeOf('function')
    expect(beforeValidate).toBeTypeOf('function')

    // Legacy data is lifted into the group shape using the configured default tag.
    expect(runHook(afterRead, 'Legacy heading')).toEqual({ tag: 'h3', value: 'Legacy heading' })
    expect(runHook(beforeValidate, 'Legacy heading')).toEqual({
      tag: 'h3',
      value: 'Legacy heading',
    })

    // Already-migrated data is left as-is on both hooks.
    const migrated = { tag: 'h2', value: 'New heading' }
    expect(runHook(afterRead, migrated)).toBe(migrated)
    expect(runHook(beforeValidate, migrated)).toBe(migrated)
  })
})

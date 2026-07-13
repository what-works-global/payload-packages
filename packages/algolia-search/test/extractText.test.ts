import type { Field } from 'payload'

import { describe, expect, it } from 'vitest'

import { extractDocumentText, extractRichTextText } from '../src/index.js'

const lexical = (...texts: string[]) => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: texts.map((text) => ({ type: 'text', text, version: 1 })),
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
})

describe('extractRichTextText', () => {
  it('collects text nodes from a Lexical state in order', () => {
    expect(extractRichTextText(lexical('Hello', 'world'))).toBe('Hello world')
  })

  it('handles Slate-style arrays', () => {
    expect(extractRichTextText([{ children: [{ text: 'Slate text' }] }])).toBe('Slate text')
  })

  it('parses stringified states and ignores non-JSON strings', () => {
    expect(extractRichTextText(JSON.stringify(lexical('Stored as string')))).toBe(
      'Stored as string',
    )
    expect(extractRichTextText('just a plain string')).toBe('')
    expect(extractRichTextText('{"root": broken')).toBe('')
  })

  it('returns empty for nullish values', () => {
    expect(extractRichTextText(null)).toBe('')
    expect(extractRichTextText(undefined)).toBe('')
  })
})

describe('extractDocumentText', () => {
  const fields = [
    { name: 'title', type: 'text' },
    { name: 'slug', type: 'text' },
    { name: 'internalNotes', type: 'textarea', custom: { algoliaSearch: false } },
    { name: 'status', type: 'select', custom: { algoliaSearch: true }, options: [] },
    { name: 'audience', type: 'select', options: [] },
    {
      name: 'hero',
      type: 'group',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'intro', type: 'richText' },
      ],
    },
    {
      type: 'tabs',
      tabs: [
        { fields: [{ name: 'summary', type: 'textarea' }], label: 'Unnamed' },
        { name: 'details', fields: [{ name: 'body', type: 'richText' }] },
      ],
    },
    {
      name: 'faqs',
      type: 'array',
      fields: [
        { name: 'question', type: 'text' },
        { name: 'answer', type: 'textarea' },
      ],
    },
    {
      name: 'components',
      type: 'blocks',
      blocks: [
        {
          slug: 'textBlock',
          fields: [{ name: 'heading', type: 'text' }],
        },
      ],
    },
    { name: 'tags', type: 'text', hasMany: true },
  ] as unknown as Field[]

  const data = {
    slug: 'some-page',
    audience: 'internal',
    components: [
      { blockType: 'textBlock', heading: 'Block heading' },
      { blockType: 'unknownBlock', heading: 'should be skipped' },
    ],
    details: { body: lexical('Tab body') },
    faqs: [
      { answer: 'Answer one', question: 'Question one?' },
      { answer: 'Answer   two', question: 'Question two?' },
    ],
    hero: { eyebrow: 'Eyebrow  text', intro: lexical('Hero intro') },
    internalNotes: 'never index this',
    status: 'published',
    summary: 'Unnamed tab summary',
    tags: ['alpha', 'beta'],
    title: 'Page title',
  }

  it('walks tabs, groups, arrays, and blocks in field order and collapses whitespace', () => {
    const text = extractDocumentText({ data, exclude: ['slug', 'title'], fields })
    expect(text).toBe(
      'published Eyebrow text Hero intro Unnamed tab summary Tab body Question one? Answer one Question two? Answer two Block heading alpha beta',
    )
  })

  it('respects name and dot-path excludes', () => {
    const text = extractDocumentText({
      data,
      exclude: ['slug', 'title', 'faqs', 'hero.eyebrow', 'details'],
      fields,
    })
    expect(text).toBe('published Hero intro Unnamed tab summary Block heading alpha beta')
  })

  it('custom.algoliaSearch wins over exclude lists in both directions', () => {
    // status is force-included even when excluded by name; internalNotes never appears
    const text = extractDocumentText({
      data,
      exclude: ['slug', 'title', 'status', 'internalNotes'],
      fields,
    })
    expect(text).toContain('published')
    expect(text).not.toContain('never index this')
    // non-opted-in select stays out
    expect(text).not.toContain('internal')
  })

  it('resolves string block references through the blocks map', () => {
    const referencedFields = [
      { name: 'refs', type: 'blocks', blockReferences: ['refBlock'], blocks: [] },
    ] as unknown as Field[]
    const text = extractDocumentText({
      blocks: { refBlock: { fields: [{ name: 'label', type: 'text' }] as Field[] } },
      data: { refs: [{ blockType: 'refBlock', label: 'Referenced text' }] },
      fields: referencedFields,
    })
    expect(text).toBe('Referenced text')
  })

  it('stops at the limit', () => {
    const text = extractDocumentText({ data, exclude: ['slug'], fields, limit: 10 })
    expect(text.length).toBeLessThanOrEqual(10)
    expect(text.startsWith('Page title'.slice(0, 10))).toBe(true)
  })

  it('uses a custom richTextToText when provided', () => {
    const text = extractDocumentText({
      data: { hero: { intro: lexical('ignored') } },
      fields: [
        {
          name: 'hero',
          type: 'group',
          fields: [{ name: 'intro', type: 'richText' }],
        },
      ] as unknown as Field[],
      richTextToText: () => 'CUSTOM',
    })
    expect(text).toBe('CUSTOM')
  })
})

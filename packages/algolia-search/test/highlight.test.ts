import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SearchHit } from '../src/exports/react.js'

import {
  Highlight,
  highlightPostTag,
  highlightPreTag,
  parseHighlightedValue,
  Snippet,
} from '../src/exports/react.js'

const mark = (text: string) => `${highlightPreTag}${text}${highlightPostTag}`

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  collection: 'news',
  objectID: 'news:1',
  ...overrides,
})

describe('parseHighlightedValue', () => {
  it('splits plain and highlighted runs in order', () => {
    expect(parseHighlightedValue(`Weather ${mark('info')} for ${mark('sailors')}`)).toEqual([
      { isHighlighted: false, text: 'Weather ' },
      { isHighlighted: true, text: 'info' },
      { isHighlighted: false, text: ' for ' },
      { isHighlighted: true, text: 'sailors' },
    ])
  })

  it('handles values that start with a match and drops empty runs', () => {
    expect(parseHighlightedValue(`${mark('Weather')} info`)).toEqual([
      { isHighlighted: true, text: 'Weather' },
      { isHighlighted: false, text: ' info' },
    ])
  })

  it('returns one plain run when nothing matched', () => {
    expect(parseHighlightedValue('Weather info')).toEqual([
      { isHighlighted: false, text: 'Weather info' },
    ])
  })

  it('unescapes the HTML entities Algolia escapes', () => {
    expect(
      parseHighlightedValue(`${mark('Fish')} &amp; Chips &lt;small&gt; &quot;a&quot; &#39;b&#39;`),
    ).toEqual([
      { isHighlighted: true, text: 'Fish' },
      { isHighlighted: false, text: ' & Chips <small> "a" \'b\'' },
    ])
  })

  it('treats an unclosed pre tag as plain text', () => {
    expect(parseHighlightedValue(`a ${highlightPreTag}b`)).toEqual([
      { isHighlighted: false, text: 'a ' },
      { isHighlighted: false, text: 'b' },
    ])
  })
})

describe('Highlight', () => {
  it('wraps matched runs in <mark> inside a wrapping <span>', () => {
    const html = renderToStaticMarkup(
      createElement(Highlight, {
        attribute: 'title',
        hit: hit({
          _highlightResult: {
            title: { matchedWords: ['info'], matchLevel: 'full', value: `Weather ${mark('info')}` },
          },
          title: 'Weather info',
        }),
      }),
    )
    expect(html).toBe('<span>Weather <mark>info</mark></span>')
  })

  it('supports a custom highlighted tag and className', () => {
    const html = renderToStaticMarkup(
      createElement(Highlight, {
        attribute: 'title',
        className: 'hit-title',
        highlightedTag: 'em',
        hit: hit({
          _highlightResult: {
            title: { matchedWords: ['info'], matchLevel: 'full', value: mark('info') },
          },
          title: 'info',
        }),
      }),
    )
    expect(html).toBe('<span class="hit-title"><em>info</em></span>')
  })

  it('joins array attributes like breadcrumbs with the separator', () => {
    const html = renderToStaticMarkup(
      createElement(Highlight, {
        attribute: 'breadcrumbs',
        hit: hit({
          _highlightResult: {
            breadcrumbs: [
              { matchedWords: [], matchLevel: 'none', value: 'Learn More' },
              { matchedWords: ['weather'], matchLevel: 'full', value: `${mark('Weather')} info` },
            ],
          },
          breadcrumbs: ['Learn More', 'Weather info'],
        }),
        separator: ' / ',
      }),
    )
    expect(html).toBe('<span>Learn More / <mark>Weather</mark> info</span>')
  })

  it('falls back to the raw attribute when there is no highlight result', () => {
    const html = renderToStaticMarkup(
      createElement(Highlight, { attribute: 'title', hit: hit({ title: 'Weather info' }) }),
    )
    expect(html).toBe('<span>Weather info</span>')
  })

  it('renders an empty span when the attribute is absent entirely', () => {
    const html = renderToStaticMarkup(
      createElement(Highlight, { attribute: 'title', hit: hit({}) }),
    )
    expect(html).toBe('<span></span>')
  })
})

describe('Snippet', () => {
  it('reads _snippetResult instead of _highlightResult', () => {
    const html = renderToStaticMarkup(
      createElement(Snippet, {
        attribute: 'content',
        hit: hit({
          _snippetResult: {
            content: { matchLevel: 'full', value: `…the ${mark('weather')} station…` },
          },
          content: 'irrelevant raw content',
        }),
      }),
    )
    expect(html).toBe('<span>…the <mark>weather</mark> station…</span>')
  })
})

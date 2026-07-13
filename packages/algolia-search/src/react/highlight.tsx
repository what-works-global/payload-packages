'use client'

import type { HighlightResult, SnippetResult } from 'algoliasearch/lite'

import React, { Fragment } from 'react'

import type { SearchHit } from './types.js'

/**
 * Sentinel tags `useAlgoliaSearch` requests highlights with instead of the
 * default `<em>`. They can't occur in document text the way markup can, so
 * `<Highlight>` / `<Snippet>` split highlighted values into React text nodes
 * without an HTML parser — and never touch `dangerouslySetInnerHTML`.
 */
export const highlightPreTag = '__aa-highlight__'
export const highlightPostTag = '__/aa-highlight__'

export interface HighlightPart {
  isHighlighted: boolean
  text: string
}

/** Algolia HTML-escapes highlighted values; undo it before rendering as text. */
const entities: Record<string, string> = { '#39': "'", amp: '&', gt: '>', lt: '<', quot: '"' }

const unescapeHTML = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|#39);/g, (match, entity: string) => entities[entity] ?? match)

/** Split a highlighted value on the sentinel tags into plain/highlighted runs. */
export const parseHighlightedValue = (value: string): HighlightPart[] => {
  const parts: HighlightPart[] = []
  const push = (isHighlighted: boolean, text: string) => {
    if (text) {
      parts.push({ isHighlighted, text: unescapeHTML(text) })
    }
  }
  const [head = '', ...rest] = value.split(highlightPreTag)
  push(false, head)
  for (const chunk of rest) {
    const close = chunk.indexOf(highlightPostTag)
    if (close === -1) {
      push(false, chunk)
    } else {
      push(true, chunk.slice(0, close))
      push(false, chunk.slice(close + highlightPostTag.length))
    }
  }
  return parts
}

export interface HighlightedAttributeProps {
  /** Top-level record attribute, e.g. `'title'`, `'content'`, `'breadcrumbs'`. */
  attribute: string
  /** Applied to the wrapping `<span>`. */
  className?: string
  /** Element (or component) rendered around matched runs. Default `'mark'`. */
  highlightedTag?: React.ElementType
  hit: SearchHit
  /** Joins the entries of array attributes like `breadcrumbs`. Default `', '`. */
  separator?: React.ReactNode
}

/** Flatten a highlight/snippet entry (option, or array of options) to its values. */
const collectValues = (result: HighlightResult | SnippetResult | undefined): string[] => {
  if (!result) {
    return []
  }
  if (Array.isArray(result)) {
    return result.flatMap(collectValues)
  }
  if ('value' in result && typeof result.value === 'string') {
    return [result.value]
  }
  return []
}

const AttributeParts: React.FC<
  { result: HighlightResult | SnippetResult | undefined } & HighlightedAttributeProps
> = ({
  attribute,
  className,
  highlightedTag: HighlightedTag = 'mark',
  hit,
  result,
  separator = ', ',
}) => {
  const values = collectValues(result)

  // No highlight/snippet for this attribute (not configured, or no query yet)
  // — fall back to the raw record value, rendered plain.
  if (values.length === 0) {
    const raw = hit[attribute]
    const rawValues = (Array.isArray(raw) ? raw : [raw]).filter((value) => value != null)
    return (
      <span className={className}>
        {rawValues.map((value, index) => (
          <Fragment key={index}>
            {index > 0 ? separator : null}
            {String(value)}
          </Fragment>
        ))}
      </span>
    )
  }

  return (
    <span className={className}>
      {values.map((value, index) => (
        <Fragment key={index}>
          {index > 0 ? separator : null}
          {parseHighlightedValue(value).map((part, partIndex) =>
            part.isHighlighted ? (
              <HighlightedTag key={partIndex}>{part.text}</HighlightedTag>
            ) : (
              <Fragment key={partIndex}>{part.text}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </span>
  )
}

/**
 * Render an attribute with the query's matches wrapped in `<mark>` (or
 * `highlightedTag`). Pair with hits from `useAlgoliaSearch` — it requests the
 * sentinel highlight tags this component splits on.
 */
export const Highlight: React.FC<HighlightedAttributeProps> = (props) => (
  <AttributeParts {...props} result={props.hit._highlightResult?.[props.attribute]} />
)

/**
 * Render an attribute's match-centred excerpt with matches wrapped in `<mark>`
 * (or `highlightedTag`). The attribute must be in `attributesToSnippet` — the
 * plugin's default index settings snippet `content`.
 */
export const Snippet: React.FC<HighlightedAttributeProps> = (props) => (
  <AttributeParts {...props} result={props.hit._snippetResult?.[props.attribute]} />
)

'use client'

import { useField } from '@payloadcms/ui'
// `use` is React 19 only; this package supports React 18+, so `useContext` stays.
// eslint-disable-next-line @eslint-react/no-use-context
import React, { createContext, useContext } from 'react'

import type { HeadingTag } from '../types.js'

import { HEADING_TAG_FIELD_NAME } from '../shared.js'
import './HeadingGroupField.scss'

const baseClass = 'heading-field'

interface HeadingTagContextValue {
  readonly path: string
  readonly readOnly: boolean
  readonly tags: readonly HeadingTag[]
}

const HeadingTagContext = createContext<HeadingTagContextValue | null>(null)

/**
 * Supplies the surrounding heading field's path, tags and read-only state to any
 * `HeadingTagSelect` rendered within it (including one placed inside a custom
 * `Label`). Internal — used by `HeadingGroupField`.
 */
export const HeadingTagProvider = HeadingTagContext.Provider

export interface HeadingTagSelectProps {
  /** Accessible name for the native select. @default 'Heading tag' */
  readonly 'aria-label'?: string
  readonly className?: string
  readonly id?: string
  /**
   * Path to the heading group. Defaults to the surrounding heading field, so it
   * is only needed when rendering the select outside one.
   */
  readonly path?: string
  /** Force the select disabled, on top of the form's own read-only state. */
  readonly readOnly?: boolean
  /**
   * Selectable tags, in display order. Defaults to the surrounding heading
   * field's configured tags.
   */
  readonly tags?: readonly HeadingTag[]
}

/**
 * The compact heading-tag dropdown. Rendered by default in the heading field's
 * header, and exported so a custom `Label` — or any custom component within the
 * field — can place it wherever it likes.
 *
 * Inside a heading field it needs no props: it reads the path, tags and
 * read-only state from context. Pass `path` and `tags` to use it standalone.
 */
export const HeadingTagSelect: React.FC<HeadingTagSelectProps> = ({
  id,
  'aria-label': ariaLabel = 'Heading tag',
  className,
  path: pathProp,
  readOnly: readOnlyProp,
  tags: tagsProp,
}) => {
  // eslint-disable-next-line @eslint-react/no-use-context
  const context = useContext(HeadingTagContext)
  const path = pathProp ?? context?.path
  const tags = tagsProp ?? context?.tags

  // Hooks must run unconditionally; we validate below before rendering.
  const { disabled, formInitializing, formProcessing, setValue, value } = useField<HeadingTag>({
    path: path ? `${path}.${HEADING_TAG_FIELD_NAME}` : '',
  })

  if (!path || !tags) {
    throw new Error(
      'HeadingTagSelect must be rendered inside a heading field, or be given `path` and `tags` props.',
    )
  }

  const isDisabled = Boolean(
    (readOnlyProp ?? context?.readOnly) || disabled || formInitializing || formProcessing,
  )

  return (
    <select
      aria-label={ariaLabel}
      className={[`${baseClass}__tag-select`, className].filter(Boolean).join(' ')}
      disabled={isDisabled}
      id={id}
      onChange={(event) => setValue(event.target.value)}
      value={value ?? ''}
    >
      {tags.map((tag) => (
        <option key={tag} value={tag}>
          {tag.toUpperCase()}
        </option>
      ))}
    </select>
  )
}

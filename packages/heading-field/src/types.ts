import type { RichTextField, TextareaField, TextField } from 'payload'

/** The HTML heading tags a content editor can choose between. */
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

/** The field types whose value can be wrapped by a selectable heading tag. */
export type HeadingValueField = RichTextField | TextareaField | TextField

export interface HeadingFieldConfig {
  /** Tag to pre-select for new documents.
   * @default 'h2'
   */
  readonly defaultTag?: HeadingTag
  /** Tags offered in the inline dropdown, in display order.
   * @default ['h1', 'h2', 'h3', 'h4', 'h5']
   */
  readonly tags?: readonly HeadingTag[]
  /** Text shown in the “(?)” tooltip beside the field label. Overrides the
   * built-in, content-editor-friendly explanation of heading levels and SEO.
   */
  readonly tooltip?: string
}

/** Shape stored in the database / returned by the API for a heading field. */
export interface HeadingValue<TValue = unknown> {
  readonly tag: HeadingTag
  readonly value: TValue
}

/**
 * Like `Partial<T>`, but each property may also be `null`. Matches the shape
 * Payload generates for an optional field, where values are typed `T | null`
 * (e.g. `value?: string | null`) rather than merely optional.
 */
export type NullablePartial<T> = { readonly [K in keyof T]?: null | T[K] }

/** Extra props handed to the inline tag selector via `admin.components.Field.clientProps`. */
export interface HeadingFieldClientProps {
  readonly headingTags: HeadingTag[]
}

import React from 'react'

import type { HeadingTag, HeadingValue } from '../types.js'

export interface RenderHeadingProps<TValue = unknown>
  extends Omit<React.HTMLAttributes<HTMLHeadingElement>, 'children'> {
  /**
   * Pre-rendered content for the heading. Provide this when the value is rich
   * text (convert the Lexical state to JSX in your app and pass it here).
   * Takes precedence over `render` and the raw string value.
   */
  readonly children?: React.ReactNode
  /**
   * The `{ tag, value }` object stored by `headingField()`. Accepts a partial
   * shape so it takes Payload's generated types directly — non-required heading
   * fields type `value` (and sometimes the whole group) as optional. A missing
   * `tag` falls back to `fallbackTag`; with no resolvable content the component
   * renders nothing rather than an empty heading.
   */
  readonly data: null | Partial<HeadingValue<TValue>> | undefined
  /** Tag to use when `data.tag` is missing. @default 'h2' */
  readonly fallbackTag?: HeadingTag
  /** Attached to the emitted heading element when content resolves. */
  readonly ref?: React.Ref<HTMLHeadingElement>
  /**
   * Render the stored value into React nodes. Use for rich text values — e.g.
   * `render={(value) => <RichText data={value} />}`. The argument is typed from
   * `data`, so no cast is needed. Ignored when `children` is provided, and only
   * called when the value is present.
   */
  readonly render?: (value: TValue) => React.ReactNode
}

/**
 * Renders a heading field's `{ tag, value }` object as the chosen heading tag.
 *
 * NOTE: This is an intentionally small starting point. It handles plain string
 * values (text / textarea) out of the box. For rich text values, pass a
 * converter via `render` or pre-rendered nodes via `children` — the shape of a
 * Lexical converter is app-specific, so it is deliberately left to the caller.
 *
 * Generic over the value type so `render` is typed straight from `data`. It is
 * commonly wrapped to inject an app's converter once — see the README.
 *
 * Accepts a `ref` and attaches it to the emitted heading element, for callers
 * that measure or animate the heading (e.g. a fit-to-width font-size hook). The
 * ref is not attached when the component renders nothing (no resolvable content).
 *
 * @example
 * // text / textarea
 * <RenderHeading data={page.heading} className="display" />
 *
 * @example
 * // rich text — `value` is typed from `data`, no cast
 * <RenderHeading data={page.intro} render={(value) => <RichText data={value} />} />
 *
 * @example
 * // ref attached to the heading element — `value` is typed from `data`
 * <RenderHeading data={page.heading} ref={headingRef} />
 */
export function RenderHeading<TValue = unknown>({
  children,
  data,
  fallbackTag = 'h2',
  ref,
  render,
  ...rest
}: RenderHeadingProps<TValue>): React.ReactNode {
  if (!data) {
    return null
  }

  let content: React.ReactNode = null

  if (children !== undefined) {
    content = children
  } else if (data.value != null) {
    if (render) {
      content = render(data.value)
    } else if (typeof data.value === 'string') {
      content = data.value
    }
  }

  // Never emit an empty heading — bad for SEO and accessibility, and this field
  // exists precisely to get heading semantics right. Render nothing instead.
  if (content == null || content === '') {
    return null
  }

  const Tag: HeadingTag = data.tag ?? fallbackTag

  return (
    <Tag {...rest} ref={ref}>
      {content}
    </Tag>
  )
}

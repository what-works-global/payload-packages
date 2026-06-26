'use client'

import React from 'react'

import './HeadingGroupField.scss'

const baseClass = 'heading-field'

const DEFAULT_LABEL = 'HTML Tag'
const DEFAULT_TOOLTIP = 'Sets the heading level (H1–H6) for SEO and page structure.'

export interface HeadingTagTooltipProps {
  readonly className?: string
  /** Hide the leading em-dash separator. @default false */
  readonly hideSeparator?: boolean
  /** Text shown before the help icon. @default 'HTML Tag' */
  readonly label?: string
  /** Tooltip content shown when hovering or focusing the help icon. */
  readonly tooltip?: React.ReactNode
}

/**
 * The “— HTML Tag (?)” indicator shown beside the field label, styled like
 * Payload's localized-field indicator. Hovering (or focusing) the help icon
 * reveals a simple CSS tooltip.
 *
 * Exported so a custom `Label` can reconstruct the header — field label, this
 * tooltip, and `HeadingTagSelect` — in whatever arrangement it likes.
 */
export const HeadingTagTooltip: React.FC<HeadingTagTooltipProps> = ({
  className,
  hideSeparator = false,
  label = DEFAULT_LABEL,
  tooltip = DEFAULT_TOOLTIP,
}) => {
  return (
    <span className={[`${baseClass}__tag-info`, className].filter(Boolean).join(' ')}>
      {!hideSeparator && (
        <span aria-hidden="true" className={`${baseClass}__tag-sep`}>
          {'— '}
        </span>
      )}
      {label}
      <button
        aria-label={typeof tooltip === 'string' ? tooltip : undefined}
        className={`${baseClass}__tooltip`}
        type="button"
      >
        {/* Lucide "circle-help" icon (ISC licensed), inlined to avoid a dependency. */}
        <svg
          aria-hidden="true"
          className={`${baseClass}__tooltip-icon`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        <span className={`${baseClass}__tooltip-content`} role="tooltip">
          {tooltip}
        </span>
      </button>
    </span>
  )
}

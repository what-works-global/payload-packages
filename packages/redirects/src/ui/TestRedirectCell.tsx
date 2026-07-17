'use client'

import type { DefaultCellComponentProps } from 'payload'

import { Button } from '@payloadcms/ui'
import React from 'react'

import { ExternalLinkIcon } from './ExternalLinkIcon.js'
import { testRedirectHref } from './shared.js'

/**
 * List-view "Test Redirect" cell: a compact anchor button that opens the
 * redirect's "From URL" in a new tab so an editor can confirm it fires. Renders
 * an em dash when the "From" value isn't openable — empty, a regex pattern, or a
 * non-path substring match. Payload renders custom cells in a plain `<td>` with
 * no row-level click handler, so the anchor navigates on its own.
 */
export const TestRedirectCell: React.FC<DefaultCellComponentProps> = ({ rowData }) => {
  const from = typeof rowData?.from === 'string' ? rowData.from : ''
  const matchType = typeof rowData?.matchType === 'string' ? rowData.matchType : 'exact'

  const href = testRedirectHref(from, matchType)
  if (!href) {
    return <span>—</span>
  }

  return (
    <Button
      buttonStyle="secondary"
      className="redirect-test-redirect__cell-button"
      el="anchor"
      icon={<ExternalLinkIcon />}
      iconPosition="right"
      iconStyle="none"
      margin={false}
      newTab
      size="small"
      url={href}
    >
      Test
    </Button>
  )
}

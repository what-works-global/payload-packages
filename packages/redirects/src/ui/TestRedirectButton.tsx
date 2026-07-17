'use client'

import { Button, useFormFields } from '@payloadcms/ui'
import React from 'react'

import { ExternalLinkIcon } from './ExternalLinkIcon.js'
import { testRedirectHref } from './shared.js'

/**
 * Sidebar action that opens the redirect's "From URL" in a new tab so an editor
 * can confirm it resolves to the destination. A real anchor — so middle-click,
 * "open in new tab", and "copy link" all work — pointed at the live form value.
 * Disabled when the "From" value isn't openable: empty, a regex pattern, or a
 * substring that isn't a path.
 */
export const TestRedirectButton: React.FC = () => {
  const from = useFormFields(([fields]) => {
    const value = fields?.from?.value
    return typeof value === 'string' ? value : ''
  })
  const matchType = useFormFields(([fields]) => {
    const value = fields?.matchType?.value
    return typeof value === 'string' ? value : 'exact'
  })

  const href = testRedirectHref(from, matchType)

  return (
    <div className="field-type redirect-test-redirect">
      <Button
        buttonStyle="secondary"
        className="redirect-test-redirect__button"
        disabled={!href}
        el="anchor"
        icon={<ExternalLinkIcon />}
        iconPosition="right"
        iconStyle="none"
        margin={false}
        newTab
        size="large"
        tooltip={
          href ? undefined : 'Enter an exact From path or absolute URL to open it in a new tab.'
        }
        url={href ?? undefined}
      >
        Test Redirect
      </Button>
    </div>
  )
}

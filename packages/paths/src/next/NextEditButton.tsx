/**
 * Draft-mode-aware server wrapper for the edit button. A server component:
 * it awaits `draftMode()` (safe on static pages — reading it does not opt
 * into dynamic rendering) and hands the flag to the client component, which
 * then skips the editor-hint gate and resolves newest-version content while
 * previewing. Mount once in the root layout.
 */
import { draftMode } from 'next/headers.js'
import React from 'react'

import type { PathsEditButtonProps } from '../client/EditButton.js'

import { PathsEditButton } from '../client/EditButton.js'

export type NextPathsEditButtonProps = Omit<PathsEditButtonProps, 'draft'>

export const NextPathsEditButton = async (
  props: NextPathsEditButtonProps,
): Promise<React.JSX.Element> => {
  const { isEnabled } = await draftMode()
  return <PathsEditButton {...props} draft={isEnabled} />
}

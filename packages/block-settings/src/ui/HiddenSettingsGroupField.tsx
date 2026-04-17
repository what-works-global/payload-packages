'use client'

import type { GroupFieldClientComponent, GroupFieldClientProps } from 'payload'

import { GroupField } from '@payloadcms/ui'

import { getBlockSettingsFieldLocation } from '../shared.js'
import { useInlineSettingsOpen } from './inlineSettingsStore.js'

export const HiddenSettingsGroupField: GroupFieldClientComponent = (
  props: GroupFieldClientProps,
) => {
  const field = {
    ...props.field,
    type: 'group' as const,
  }
  const location = getBlockSettingsFieldLocation(field)
  const isVisible = useInlineSettingsOpen(props.path)

  if (location === 'inline' && isVisible) {
    return <GroupField {...props} />
  }

  return null
}

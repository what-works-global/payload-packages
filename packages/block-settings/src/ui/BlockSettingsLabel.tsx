'use client'

import React from 'react'

import { type BlockLabelWithActionsProps, BlockLabelWithActions } from './BlockLabelWithActions.js'
import { BlockSettingsToggleButton } from './BlockSettingsToggleButton.js'

export const BlockSettingsLabel: React.FC<BlockLabelWithActionsProps> = (props) => {
  return <BlockLabelWithActions {...props} actions={[BlockSettingsToggleButton]} />
}

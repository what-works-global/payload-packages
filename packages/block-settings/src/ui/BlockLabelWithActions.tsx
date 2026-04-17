'use client'

import { Pill, SectionTitle } from '@payloadcms/ui'
import React from 'react'

import type { BlockLabelActionComponent, BlockLabelActionProps } from './useBlockLabelState.js'
import { useBlockLabelState } from './useBlockLabelState.js'
import './BlockLabelWithActions.scss'

const baseClass = 'blocks-field'

export type BlockLabelWithActionsProps = BlockLabelActionProps & {
  readonly actions?: BlockLabelActionComponent[]
}

export const BlockLabelWithActions: React.FC<BlockLabelWithActionsProps> = ({
  actions = [],
  ...props
}) => {
  const { block, path, readOnly, resolvedRowNumber, rowLabel } = useBlockLabelState(props)
  const showBlockName = !Boolean(block?.admin?.disableBlockName)

  const pillClassName = [`${baseClass}__block-pill`]

  if (block?.slug) {
    pillClassName.push(`${baseClass}__block-pill-${block.slug}`)
  }

  return (
    <React.Fragment>
      <span className={`${baseClass}__block-number`}>
        {String(resolvedRowNumber).padStart(2, '0')}
      </span>
      <Pill className={pillClassName.join(' ')} pillStyle="white" size="small">
        {rowLabel}
      </Pill>
      {showBlockName && <SectionTitle path={`${path}.blockName`} readOnly={readOnly} />}
      {actions.map((Action, index) => (
        <Action
          key={`${Action.displayName ?? Action.name ?? 'action'}-${String(index)}`}
          {...props}
        />
      ))}
    </React.Fragment>
  )
}

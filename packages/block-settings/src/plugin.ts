import type { Block, Config, Field, Plugin, Tab } from 'payload'

import { blockSettingsFieldMatches } from './shared.js'
import type { BlockSettingsPluginOptions } from './types.js'

const defaultPluginOptions: Required<
  Pick<BlockSettingsPluginOptions, 'overrideExistingLabel' | 'settingsFieldName'>
> = {
  overrideExistingLabel: false,
  settingsFieldName: 'settings',
}

const labelComponentPath = '@whatworks/payload-block-settings/client#BlockSettingsLabel'

type TraversableNode = Block | Field | Tab

const getFieldName = (field: Field): string | undefined => {
  if (!('name' in field) || typeof field.name !== 'string') {
    return undefined
  }

  return field.name
}

const mergeBlockSettingsFields = ({
  block,
  settingsFieldName,
}: {
  block: Block
  settingsFieldName: string
}): Field | undefined => {
  const matchingFields = block.fields.filter((field) =>
    blockSettingsFieldMatches(field, settingsFieldName),
  )

  if (matchingFields.length === 0) {
    return undefined
  }

  if (matchingFields.length === 1) {
    return matchingFields[0]
  }

  const seenFieldNames = new Set<string>()

  for (const settingsField of matchingFields) {
    for (const childField of settingsField.fields) {
      const childFieldName = getFieldName(childField)

      if (!childFieldName) {
        continue
      }

      if (seenFieldNames.has(childFieldName)) {
        throw new Error(
          `Duplicate block settings field "${childFieldName}" found while merging settings groups on block "${block.slug}".`,
        )
      }

      seenFieldNames.add(childFieldName)
    }
  }

  const [firstSettingsField, ...restSettingsFields] = matchingFields
  const mergedSettingsField = {
    ...firstSettingsField,
    fields: matchingFields.flatMap((field) => field.fields),
  }
  const mergedSettingsFieldIndex = block.fields.findIndex((field) => field === firstSettingsField)
  const settingsFieldsToRemove = new Set<Field>(restSettingsFields)
  const nextFields = block.fields.filter((field) => !settingsFieldsToRemove.has(field))

  nextFields.splice(mergedSettingsFieldIndex, 1, mergedSettingsField)
  block.fields = nextFields

  return mergedSettingsField
}

const visitNodes = ({
  nodes,
  onBlock,
  visitedBlocks,
}: {
  nodes: TraversableNode[]
  onBlock: (block: Block) => void
  visitedBlocks: Set<Block>
}): void => {
  for (const node of nodes) {
    if ('slug' in node && Array.isArray(node.fields)) {
      if (visitedBlocks.has(node)) {
        continue
      }

      visitedBlocks.add(node)
      onBlock(node)
      visitNodes({
        nodes: node.fields,
        onBlock,
        visitedBlocks,
      })
      continue
    }

    if ('fields' in node && Array.isArray(node.fields)) {
      visitNodes({
        nodes: node.fields,
        onBlock,
        visitedBlocks,
      })
      continue
    }

    if ('type' in node && node.type === 'blocks') {
      const inlineBlocks = node.blocks.filter((block): block is Block => typeof block !== 'string')

      for (const block of inlineBlocks) {
        if (visitedBlocks.has(block)) {
          continue
        }

        visitedBlocks.add(block)
        onBlock(block)
        visitNodes({
          nodes: block.fields,
          onBlock,
          visitedBlocks,
        })
      }

      continue
    }

    if ('type' in node && node.type === 'tabs') {
      visitNodes({
        nodes: node.tabs,
        onBlock,
        visitedBlocks,
      })
    }
  }
}

export const blockSettingsPlugin =
  (incomingOptions: BlockSettingsPluginOptions = {}): Plugin =>
  (config: Config): Config => {
    const options = {
      ...defaultPluginOptions,
      ...incomingOptions,
    }

    const visitedBlocks = new Set<Block>()

    const patchBlock = (block: Block): void => {
      const mergedSettingsField = mergeBlockSettingsFields({
        block,
        settingsFieldName: options.settingsFieldName,
      })
      const hasSettingsField = Boolean(mergedSettingsField)

      if (!hasSettingsField) {
        return
      }

      if (!block.admin) {
        block.admin = {}
      }

      if (!block.admin.components) {
        block.admin.components = {}
      }

      if (block.admin.components.Label && !options.overrideExistingLabel) {
        return
      }

      block.admin.components.Label = {
        clientProps: {
          settingsFieldName: options.settingsFieldName,
        },
        path: labelComponentPath,
      }
    }

    if (Array.isArray(config.blocks)) {
      for (const block of config.blocks) {
        if (visitedBlocks.has(block)) {
          continue
        }

        visitedBlocks.add(block)
        patchBlock(block)
        visitNodes({
          nodes: block.fields,
          onBlock: patchBlock,
          visitedBlocks,
        })
      }
    }

    for (const collection of config.collections ?? []) {
      visitNodes({
        nodes: collection.fields,
        onBlock: patchBlock,
        visitedBlocks,
      })
    }

    for (const global of config.globals ?? []) {
      visitNodes({
        nodes: global.fields,
        onBlock: patchBlock,
        visitedBlocks,
      })
    }

    return config
  }

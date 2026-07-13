import type { Field } from 'payload'

import type { BlocksMap } from './types.js'

/**
 * Pull the human-readable text out of a rich text value by collecting every
 * string stored under a `text` key, in document order. Works on Lexical and
 * Slate states alike without needing either editor package, and accepts
 * stringified states (as stored by richtext-stringify-style plugins).
 */
export const extractRichTextText = (value: unknown): string => {
  let root = value
  if (typeof root === 'string') {
    const trimmed = root.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return ''
    }
    try {
      root = JSON.parse(trimmed)
    } catch {
      return ''
    }
  }
  if (!root || typeof root !== 'object') {
    return ''
  }

  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') {
      return
    }
    for (const [key, entry] of Object.entries(node)) {
      if (key === 'text' && typeof entry === 'string') {
        parts.push(entry)
      } else if (entry && typeof entry === 'object') {
        walk(entry)
      }
    }
  }
  walk(root)
  return parts.join(' ')
}

export interface ExtractDocumentTextArgs {
  /** Registered blocks (`payload.blocks`) so `blockReferences` resolve. */
  blocks?: BlocksMap
  data: unknown
  /** Field names (matched at any depth) or dot-paths from the document root. */
  exclude?: string[]
  fields: Field[]
  /** Stop collecting once this many characters are gathered. */
  limit?: number
  /** Rich text extraction; defaults to the generic text-node walker. */
  richTextToText?: (value: unknown) => string
}

type NamedField = { custom?: Record<string, unknown>; name: string }

/**
 * Best-effort text extraction: walk the collection's field config alongside
 * the document data and collect every `text`, `textarea`, and `richText`
 * value — through tabs, groups, rows, collapsibles, arrays, and blocks — into
 * one whitespace-collapsed string in document order.
 *
 * Field-level `custom: { algoliaSearch: false }` always excludes a field;
 * `custom: { algoliaSearch: true }` force-includes it (and lets non-text
 * scalar fields such as selects opt in), both taking precedence over `exclude`.
 */
export const extractDocumentText = ({
  blocks,
  data,
  exclude = [],
  fields,
  limit,
  richTextToText = extractRichTextText,
}: ExtractDocumentTextArgs): string => {
  const excludeSet = new Set(exclude)
  const budget = limit ?? Number.POSITIVE_INFINITY
  const parts: string[] = []
  let length = 0

  const full = () => length >= budget

  const push = (raw: unknown): void => {
    if (typeof raw !== 'string') {
      return
    }
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text) {
      return
    }
    parts.push(text)
    length += text.length + 1
  }

  const pushScalars = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        pushScalars(entry)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      push(String(value))
    } else {
      push(value)
    }
  }

  const isExcluded = (field: NamedField, path: string): boolean => {
    const flag = field.custom?.algoliaSearch
    if (flag === false) {
      return true
    }
    if (flag === true) {
      return false
    }
    return excludeSet.has(field.name) || excludeSet.has(path)
  }

  const resolveBlock = (
    field: Extract<Field, { type: 'blocks' }>,
    blockType: unknown,
  ): { fields: Field[] } | undefined => {
    const references = (field as { blockReferences?: unknown[] }).blockReferences ?? []
    for (const entry of [...(field.blocks ?? []), ...references]) {
      // string references are the block slug itself; resolve via the blocks map
      const block =
        typeof entry === 'string'
          ? entry === blockType
            ? blocks?.[entry]
            : undefined
          : (entry as { slug?: unknown }).slug === blockType
            ? entry
            : undefined
      if (block && typeof block === 'object') {
        return block as { fields: Field[] }
      }
    }
    return undefined
  }

  const visitFields = (fieldList: Field[], value: unknown, parentPath: string): void => {
    if (full() || !value || typeof value !== 'object') {
      return
    }
    const record = value as Record<string, unknown>

    for (const field of fieldList) {
      if (full()) {
        return
      }

      // unnamed layout containers share the parent's data
      if (field.type === 'row' || field.type === 'collapsible') {
        visitFields(field.fields, record, parentPath)
        continue
      }
      if (field.type === 'tabs') {
        for (const tab of field.tabs) {
          if (full()) {
            return
          }
          if ('name' in tab && tab.name) {
            const tabPath = parentPath ? `${parentPath}.${tab.name}` : tab.name
            if (excludeSet.has(tab.name) || excludeSet.has(tabPath)) {
              continue
            }
            visitFields(tab.fields, record[tab.name], tabPath)
          } else {
            visitFields(tab.fields, record, parentPath)
          }
        }
        continue
      }
      if (field.type === 'group' && !('name' in field && field.name)) {
        visitFields(field.fields, record, parentPath)
        continue
      }

      if (!('name' in field) || !field.name) {
        continue
      }
      const named = field as unknown as NamedField
      const path = parentPath ? `${parentPath}.${named.name}` : named.name
      if (isExcluded(named, path)) {
        continue
      }
      const fieldValue = record[named.name]

      switch (field.type) {
        case 'array':
          if (Array.isArray(fieldValue)) {
            for (const row of fieldValue) {
              if (full()) {
                return
              }
              visitFields(field.fields, row, path)
            }
          }
          break
        case 'blocks':
          if (Array.isArray(fieldValue)) {
            for (const row of fieldValue) {
              if (full()) {
                return
              }
              if (!row || typeof row !== 'object') {
                continue
              }
              const block = resolveBlock(field, (row as { blockType?: unknown }).blockType)
              if (block) {
                visitFields(block.fields, row, path)
              }
            }
          }
          break
        case 'group':
          visitFields(field.fields, fieldValue, path)
          break
        case 'richText':
          push(richTextToText(fieldValue))
          break
        case 'text':
        case 'textarea':
          pushScalars(fieldValue)
          break
        default:
          // non-text field types only contribute when explicitly opted in
          if (named.custom?.algoliaSearch === true) {
            pushScalars(fieldValue)
          }
      }
    }
  }

  visitFields(fields, data, '')

  const text = parts.join(' ')
  return limit !== undefined && text.length > limit ? text.slice(0, limit) : text
}

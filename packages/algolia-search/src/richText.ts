import type { RichTextConverters } from './types.js'

import { extractRichTextText } from './extractText.js'

type LexicalPlaintextFn = (args: { converters?: unknown; data: unknown }) => string

let lexicalConverter: LexicalPlaintextFn | null | undefined

/**
 * Lazily load Lexical's official `convertLexicalToPlaintext`.
 * `@payloadcms/richtext-lexical` is an optional peer — sites on Slate (or with
 * no rich text at all) simply fall back to the generic extractor. Memoized;
 * awaited once per process by `buildSearchRecord`.
 */
export const loadLexicalConverter = async (): Promise<LexicalPlaintextFn | null> => {
  if (lexicalConverter !== undefined) {
    return lexicalConverter
  }
  try {
    const mod = (await import('@payloadcms/richtext-lexical/plaintext')) as {
      convertLexicalToPlaintext?: unknown
    }
    lexicalConverter =
      typeof mod.convertLexicalToPlaintext === 'function'
        ? (mod.convertLexicalToPlaintext as LexicalPlaintextFn)
        : null
  } catch {
    lexicalConverter = null
  }
  return lexicalConverter
}

/**
 * The default rich text extraction:
 * 1. stringified states (richtext-stringify plugins) are parsed first
 * 2. Lexical states go through `convertLexicalToPlaintext` (with the plugin's
 *    `richTextConverters`) when the package is installed
 * 3. anything else — Slate, unloadable Lexical, custom shapes — falls back to
 *    the dependency-free text-node walker
 */
export const createRichTextToText =
  (converters?: RichTextConverters) =>
  (value: unknown): string => {
    let data = value
    if (typeof data === 'string') {
      const trimmed = data.trim()
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return ''
      }
      try {
        data = JSON.parse(trimmed)
      } catch {
        return ''
      }
    }

    if (
      lexicalConverter &&
      data &&
      typeof data === 'object' &&
      'root' in data &&
      (data as { root?: unknown }).root
    ) {
      try {
        return lexicalConverter({ converters, data })
      } catch {
        // fall through to the generic extractor
      }
    }
    return extractRichTextText(data)
  }

import {
  convertLexicalToPlaintext,
  type PlaintextConverters,
} from '@payloadcms/richtext-lexical/plaintext'

import type { FieldResolver } from '../resolvers.js'

/** Resolves a richText field by converting its value to plainText */
export const richTextPlaintextResolver =
  ({ converters }: { converters?: PlaintextConverters } = {}): FieldResolver<'richText'> =>
  ({ value }) =>
    convertLexicalToPlaintext({
      converters,
      data: value as never,
    })

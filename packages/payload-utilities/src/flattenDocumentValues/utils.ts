import type { Field, FieldSchemaMap, LabelFunction, PayloadRequest, StaticLabel } from 'payload'

import { getTranslation } from '@payloadcms/translations'

type ExtractMapValue<T> = T extends Map<any, infer V> ? V : never

type FieldSchema = ExtractMapValue<FieldSchemaMap>

export const getLabel = (fieldSchema: FieldSchema, req: PayloadRequest): string | undefined => {
  if ('label' in fieldSchema && fieldSchema.label) {
    const fieldLabel = fieldSchema.label as LabelFunction | StaticLabel
    if (typeof fieldLabel === 'function') {
      return fieldLabel({ i18n: req.i18n, t: req.i18n.t })
    } else if (typeof fieldLabel === 'object') {
      return getTranslation(fieldLabel, req.i18n)
    } else if (typeof fieldLabel === 'string') {
      return fieldLabel
    }
  }
}

export type ExtractFieldByType<T extends Field['type']> = Extract<Field, { type: T }>

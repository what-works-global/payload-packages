/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Config } from 'payload'

type JsonSchemaFunction = NonNullable<NonNullable<Config['typescript']>['schema']>[number]

/**
 * Transforms the generated payload types by assuming that you always fetch with infinite depth.
 * Preserves string literal types and other primitives.
 *
 * Changes `string | Page` to `Page`.
 *
 * Changes `(string | Page)[]` to `Page[]`.
 */
export const resolveJsonSchemaRelationships: JsonSchemaFunction = ({ jsonSchema }) => {
  const processValue = (value: any): void => {
    if (!value || typeof value !== 'object') {
      return
    }

    // Process oneOf and anyOf for relationships, handling combined string/null types
    const processOptions = (options: any[]): any[] => {
      let hasNull = false
      const keptOptions: any[] = []

      options.forEach((option: any) => {
        if (option && typeof option === 'object') {
          if (option.$ref) {
            keptOptions.push(option)
          } else if (option.type) {
            if (Array.isArray(option.type)) {
              if (option.type.includes('null')) {
                hasNull = true
                if (!option.type.includes('string')) {
                  keptOptions.push(option)
                }
              } else if (!option.type.includes('string')) {
                keptOptions.push(option)
              }
            } else if (option.type === 'null') {
              hasNull = true
              keptOptions.push(option)
            } else if (option.type !== 'string') {
              keptOptions.push(option)
            }
          } else {
            keptOptions.push(option)
          }
        } else {
          keptOptions.push(option)
        }
      })

      if (hasNull && !keptOptions.some((opt) => opt?.type === 'null')) {
        keptOptions.push({ type: 'null' })
      }

      return keptOptions
    }

    if (value.oneOf && Array.isArray(value.oneOf)) {
      const keptOptions = processOptions(value.oneOf)
      if (keptOptions.length === 1) {
        Object.assign(value, keptOptions[0])
        delete value.oneOf
      } else if (keptOptions.length > 1) {
        value.oneOf = keptOptions
      } else {
        delete value.oneOf
      }
    }

    if (value.anyOf && Array.isArray(value.anyOf)) {
      const keptOptions = processOptions(value.anyOf)
      if (keptOptions.length === 1) {
        Object.assign(value, keptOptions[0])
        delete value.anyOf
      } else if (keptOptions.length > 1) {
        value.anyOf = keptOptions
      } else {
        delete value.anyOf
      }
    }

    // Process array items (Handles type: "array" and type: ["array", "null"])
    const isArrayType =
      value.type === 'array' || (Array.isArray(value.type) && value.type.includes('array'))
    if (isArrayType && value.items) {
      processValue(value.items)
    }

    // Process object properties
    if (value.properties && typeof value.properties === 'object') {
      Object.values(value.properties).forEach(processValue)
    }

    // Process additional properties and nested objects
    Object.entries(value).forEach(([key, val]) => {
      if (
        val &&
        typeof val === 'object' &&
        key !== 'properties' &&
        key !== 'items' &&
        key !== 'oneOf' &&
        key !== 'anyOf'
      ) {
        processValue(val)
      }
    })
  }

  // Process all definitions
  if (jsonSchema.definitions) {
    Object.values(jsonSchema.definitions).forEach(processValue)
  }

  // Process top-level properties if they exist
  if (jsonSchema.properties) {
    Object.values(jsonSchema.properties).forEach(processValue)
  }

  return jsonSchema
}

import type { FieldResolver } from '../resolvers.js'

import { getLabel } from '../utils.js'

export const groupResolver: FieldResolver<'group'> = async (args) => {
  const {
    collection,
    data,
    excludedFields,
    fieldResolvers,
    indexPathSegments,
    req,
    schemaMap,
    schemaPathSegments,
  } = args
  const collectionSlug = collection.slug
  return (
    await Promise.all(
      Object.entries(data).map(async ([key, value]) => {
        const schemaPathNoCollectionSlug = [...schemaPathSegments.map((s) => s.name), key].join('.')
        if (!excludedFields.includes(schemaPathNoCollectionSlug)) {
          const schemaPath = [collectionSlug, ...schemaPathSegments.map((s) => s.name), key].join(
            '.',
          )
          const field = schemaMap.get(schemaPath)
          if (field && 'type' in field) {
            const label = getLabel(field, req) ?? key
            const newSegment = { name: key, label }
            const resolver = fieldResolvers[field.type]
            return await resolver({
              ...args,
              data: value,
              field: field as unknown as never,
              indexPathSegments: [...indexPathSegments, newSegment],
              schemaPathSegments: [...schemaPathSegments, newSegment],
            })
          }
        }
        return []
      }),
    )
  ).flat()
}

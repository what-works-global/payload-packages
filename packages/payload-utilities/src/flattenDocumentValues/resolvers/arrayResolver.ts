import type { FieldResolver } from '../resolvers.js'

import { getLabel } from '../utils.js'

export const arrayResolver: FieldResolver<'array'> = async (args) => {
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
      (data as any[]).map(async (obj, index) => {
        return (
          await Promise.all(
            Object.entries(obj).map(async ([key, value2]) => {
              if (key !== 'id') {
                const schemaPathNoCollectionSlug = [
                  ...schemaPathSegments.map((s) => s.name),
                  key,
                ].join('.')
                const schemaPath = [
                  collectionSlug,
                  ...schemaPathSegments.map((s) => s.name),
                  key,
                ].join('.')
                if (!excludedFields.includes(schemaPathNoCollectionSlug)) {
                  const field = schemaMap.get(schemaPath)
                  if (field && 'type' in field) {
                    const label = getLabel(field, req) ?? key
                    const newSegment = { name: key, label }
                    const resolver = fieldResolvers[field.type]
                    return await resolver({
                      ...args,
                      data: value2,
                      field: field as unknown as never,
                      indexPathSegments: [
                        ...indexPathSegments,
                        { name: index, label: index },
                        newSegment,
                      ],
                      schemaPathSegments: [...schemaPathSegments, newSegment],
                    })
                  }
                }
              }
              return []
            }),
          )
        ).flat()
      }),
    )
  ).flat()
}

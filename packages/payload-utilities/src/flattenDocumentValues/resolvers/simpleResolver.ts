import type { FieldResolver } from '../resolvers.js'

export const simpleResolver: FieldResolver<any> = ({
  data,
  field,
  indexPathSegments,
  schemaPathSegments,
}) => {
  return [
    {
      field,
      indexPathSegments,
      schemaPathSegments,
      value: data,
    },
  ]
}

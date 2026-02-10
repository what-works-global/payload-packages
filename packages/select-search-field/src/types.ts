import type {
  FlattenedField,
  PayloadRequest,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
} from 'payload'

export type SelectSearchOption = {
  label: string
  value: string
  [key: string]: unknown
}

export type SelectSearchFunctionArgs = {
  req: PayloadRequest
  query: string
  selectedValues: string[]
  field: FlattenedField
  collection?: SanitizedCollectionConfig
  global?: SanitizedGlobalConfig
}

export type SelectSearchFunction = (
  args: SelectSearchFunctionArgs,
) => Promise<SelectSearchOption[]> | SelectSearchOption[]

export type SelectSearchRequest = {
  entityType: 'collection' | 'global'
  slug: string
  schemaPath: string
  query?: string
  selectedValues?: string[]
}

export type SelectSearchResponse = {
  options: SelectSearchOption[]
}

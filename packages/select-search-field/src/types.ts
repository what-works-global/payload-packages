import type {
  FlattenedField,
  PayloadRequest,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
} from 'payload'

export type SelectSearchOption = {
  [key: string]: unknown
  label: string
  value: string
}

export type SelectSearchFunctionArgs = {
  collection?: SanitizedCollectionConfig
  field: FlattenedField
  global?: SanitizedGlobalConfig
  query: string
  req: PayloadRequest
  selectedValues: string[]
}

export type SelectSearchFunction = (
  args: SelectSearchFunctionArgs,
) => Promise<SelectSearchOption[]> | SelectSearchOption[]

export type SelectSearchRequest = {
  entityType: 'collection' | 'global'
  query?: string
  schemaPath: string
  selectedValues?: string[]
  slug: string
}

export type SelectSearchResponse = {
  options: SelectSearchOption[]
}

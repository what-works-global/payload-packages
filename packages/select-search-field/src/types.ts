import type {
  Data,
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
  data?: Data
  field: FlattenedField
  global?: SanitizedGlobalConfig
  query: string
  req: PayloadRequest
  selectedValues: string[]
  siblingData?: Data
}

export type SelectSearchFunction = (
  args: SelectSearchFunctionArgs,
) => Promise<SelectSearchOption[]> | SelectSearchOption[]

export type SelectSearchRequest = {
  data?: Data
  entityType: 'collection' | 'global'
  query?: string
  schemaPath: string
  selectedValues?: string[]
  siblingData?: Data
  slug: string
}

export type SelectSearchResponse = {
  options: SelectSearchOption[]
}

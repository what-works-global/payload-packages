import type {
  FlattenedField,
  PayloadRequest,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
} from 'payload'

export type SearchSelectOption = {
  label: string
  value: string
  [key: string]: unknown
}

export type SearchSelectFunctionArgs = {
  req: PayloadRequest
  query: string
  selectedValues: string[]
  field: FlattenedField
  collection?: SanitizedCollectionConfig
  global?: SanitizedGlobalConfig
}

export type SearchSelectFunction = (
  args: SearchSelectFunctionArgs,
) => Promise<SearchSelectOption[]> | SearchSelectOption[]

export type SearchSelectRequest = {
  entityType: 'collection' | 'global'
  slug: string
  schemaPath: string
  query?: string
  selectedValues?: string[]
}

export type SearchSelectResponse = {
  options: SearchSelectOption[]
}

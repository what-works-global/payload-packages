import type {
  Endpoint,
  PayloadRequest,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
} from 'payload'

import { getFieldByPath } from 'payload'

import type { SelectSearchFunction, SelectSearchRequest, SelectSearchResponse } from './types.js'

import { selectSearchEndpoint } from './endpointName.js'

const maxQueryLength = 200

const parseBody = async (req: PayloadRequest): Promise<Partial<SelectSearchRequest>> => {
  if (typeof req.json === 'function') {
    return (await req.json()) as Partial<SelectSearchRequest>
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as Partial<SelectSearchRequest>
  }

  return {}
}

export const selectSearchEndpointHandler = (): Endpoint => ({
  handler: async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: Partial<SelectSearchRequest>
    try {
      body = await parseBody(req)
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { slug, entityType, schemaPath } = body
    if (entityType !== 'collection' && entityType !== 'global') {
      return Response.json({ error: 'Invalid entityType' }, { status: 400 })
    }

    if (!slug || !schemaPath) {
      return Response.json({ error: 'Missing slug or schemaPath' }, { status: 400 })
    }

    const safeQuery = String(body.query || '').slice(0, maxQueryLength)
    const selectedValues = Array.isArray(body.selectedValues)
      ? body.selectedValues.map((value) => String(value))
      : []

    const config = req.payload.config
    const entityConfig =
      entityType === 'collection'
        ? config.collections?.find((collection) => collection.slug === slug)
        : config.globals?.find((global) => global.slug === slug)

    if (!entityConfig) {
      return Response.json({ error: 'Unknown entity' }, { status: 404 })
    }

    const fields = entityConfig.flattenedFields
    if (!Array.isArray(fields)) {
      return Response.json({ error: 'Fields not searchable' }, { status: 400 })
    }

    const fieldResult = getFieldByPath({
      fields,
      path: schemaPath.split('.').slice(1).join('.'),
    })

    if (!fieldResult) {
      return Response.json({ error: 'Field not found' }, { status: 400 })
    }

    const searchFunction = fieldResult?.field?.custom?.searchFunction as
      | SelectSearchFunction
      | undefined

    if (typeof searchFunction !== 'function') {
      return Response.json({ error: 'Field not searchable' }, { status: 400 })
    }

    const collectionConfig =
      entityType === 'collection' ? (entityConfig as SanitizedCollectionConfig) : undefined
    const globalConfig =
      entityType === 'global' ? (entityConfig as SanitizedGlobalConfig) : undefined

    const options = await searchFunction({
      collection: collectionConfig,
      field: fieldResult.field,
      global: globalConfig,
      query: safeQuery,
      req,
      selectedValues,
    })

    if (!Array.isArray(options)) {
      return Response.json({ error: 'Invalid searchFunction response' }, { status: 500 })
    }

    const res: SelectSearchResponse = {
      options,
    }

    return Response.json(res)
  },
  method: 'post',
  path: selectSearchEndpoint,
})

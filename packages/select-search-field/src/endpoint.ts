import type {
  Data,
  Endpoint,
  FlattenedField,
  PayloadRequest,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
} from 'payload'

// The `./utilities/*` subpath export maps to `dist/utilities/*.js`, so the
// package-relative `index` must be spelled out — `.../buildFieldSchemaMap`
// alone would resolve to a non-existent `buildFieldSchemaMap.js` file rather
// than the directory. Payload's own lexical code imports sibling modules from
// this same `.../buildFieldSchemaMap/` path.
import { buildFieldSchemaMap } from '@payloadcms/ui/utilities/buildFieldSchemaMap/index'

import type { SelectSearchFunction, SelectSearchRequest, SelectSearchResponse } from './types.js'

import { selectSearchEndpoint } from './endpointName.js'

const maxQueryLength = 200

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

const isObjectIdLike = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID_PATTERN.test(value)

const parseBody = async (req: PayloadRequest): Promise<Partial<SelectSearchRequest>> => {
  if (typeof req.json === 'function') {
    return (await req.json()) as Partial<SelectSearchRequest>
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as Partial<SelectSearchRequest>
  }

  return {}
}

const parseData = (value: unknown): Data | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Data
  }

  return undefined
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
    const data = parseData(body.data)
    const siblingData = parseData(body.siblingData)

    const config = req.payload.config
    const entityConfig =
      entityType === 'collection'
        ? config.collections?.find((collection) => collection.slug === slug)
        : config.globals?.find((global) => global.slug === slug)

    if (!entityConfig) {
      return Response.json({ error: 'Unknown entity' }, { status: 404 })
    }

    // Resolve the target field from its full schemaPath via Payload's field
    // schema map. The map is keyed by the exact schemaPath the client sends
    // (both come from Payload's form-state machinery) and includes fields
    // nested inside groups, arrays, blocks AND richText (lexical) blocks —
    // e.g. `...content.lexical_internal_feature.blocks.lexical_blocks.<block>.fields.<name>`.
    // Those lexical block fields are absent from `entityConfig.flattenedFields`,
    // which is why resolving via `getFieldByPath` alone fails inside a lexical
    // block. Building the map is scoped to this one entity and mirrors the work
    // Payload already does to render the document's form.
    const { fieldSchemaMap } = buildFieldSchemaMap({
      collectionSlug: entityType === 'collection' ? slug : undefined,
      config,
      globalSlug: entityType === 'global' ? slug : undefined,
      i18n: req.i18n,
    })

    const schemaField = fieldSchemaMap.get(schemaPath)
    const resolvedField =
      schemaField && 'type' in schemaField ? (schemaField as FlattenedField) : undefined

    if (!resolvedField) {
      return Response.json({ error: 'Field not found' }, { status: 400 })
    }

    const searchFunction = resolvedField.custom?.searchFunction as
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
      data,
      field: resolvedField,
      global: globalConfig,
      query: safeQuery,
      req,
      selectedValues,
      siblingData,
    })

    if (!Array.isArray(options)) {
      return Response.json({ error: 'Invalid searchFunction response' }, { status: 500 })
    }

    if (resolvedField.type === 'relationship') {
      for (const option of options) {
        if (!isObjectIdLike(option?.value)) {
          return Response.json(
            {
              error: `Invalid searchFunction response: when 'relation' is set, each option's 'value' must be a 24-character hex BSON ObjectId string. Received: ${JSON.stringify(option?.value)}`,
            },
            { status: 500 },
          )
        }
      }
    }

    const res: SelectSearchResponse = {
      options,
    }

    return Response.json(res)
  },
  method: 'post',
  path: selectSearchEndpoint,
})

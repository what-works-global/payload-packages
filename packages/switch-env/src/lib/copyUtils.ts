import type { CollectionConfig, GlobalConfig, Payload } from 'payload'

import type {
  CopyConfig,
  CopyDocumentsMode,
  CopyModeOverrides,
  CopyTargetConfig,
  CopyVersionsMode,
} from '../types.js'

type CopyMode = CopyDocumentsMode
type RuntimeCopyVersionsMode = Exclude<CopyVersionsMode, { mode: 'none' }>
const DEFAULT_COPY_MODE: CopyMode = { mode: 'all' }
const INTERNAL_MAX_LATEST_X = 100

type CollectionModeOverrides<TMode extends CopyMode> = CopyModeOverrides<string, TMode>
type GlobalModeOverrides<TMode extends CopyMode> = CopyModeOverrides<string, TMode>

export interface ResolvedCopyTargetConfig<TMode extends CopyMode> {
  collections?: CollectionModeOverrides<TMode>
  default: TMode
  globals?: GlobalModeOverrides<TMode>
}

export interface ResolvedCopyConfig {
  documents: ResolvedCopyTargetConfig<CopyDocumentsMode>
  versions: ResolvedCopyTargetConfig<RuntimeCopyVersionsMode>
}

interface NormalizeCopyConfigArgs {
  copy?: CopyConfig
  warn?: (message: string) => void
}

interface WarnOnInvalidOverrideTargetsArgs {
  collections?: CollectionConfig[]
  copy: ResolvedCopyConfig
  globals?: GlobalConfig[]
  warn?: (message: string) => void
}

interface ResolveVersionCollectionModesArgs {
  copy: ResolvedCopyConfig
  payload: Payload
}

interface ResolvePayloadCollectionScopesArgs {
  copy: ResolvedCopyConfig
  payload: Payload
}

export interface VersionCollectionModes {
  [collectionName: string]: RuntimeCopyVersionsMode
}

export interface CollectionCopyScope {
  filter?: Record<string, unknown>
  mode: CopyDocumentsMode
}

export interface PayloadCollectionScopes {
  [collectionName: string]: CollectionCopyScope[]
}

export const normalizeCopyConfig = ({
  copy,
  warn,
}: NormalizeCopyConfigArgs): ResolvedCopyConfig => {
  const fromObject = copy || {}
  const maxX = INTERNAL_MAX_LATEST_X

  const normalizedVersions = normalizeTargetConfig(fromObject.versions, 'copy.versions', maxX, warn)

  return {
    documents: normalizeTargetConfig(fromObject.documents, 'copy.documents', maxX, warn),
    versions: {
      collections: coerceVersionOverrides(normalizedVersions.collections),
      default: coerceVersionMode(normalizedVersions.default),
      globals: coerceVersionOverrides(normalizedVersions.globals),
    },
  }
}

export const warnOnInvalidOverrideTargets = ({
  collections = [],
  copy,
  globals = [],
  warn,
}: WarnOnInvalidOverrideTargetsArgs): void => {
  const collectionVersionsBySlug = new Map(
    collections.map((collection) => [collection.slug, Boolean(collection.versions)]),
  )
  const globalVersionsBySlug = new Map(
    globals.map((global) => [global.slug, Boolean(global.versions)]),
  )

  warnOnEntityOverrides({
    enabledBySlug: collectionVersionsBySlug,
    entityName: 'collection',
    overrides: copy.documents.collections,
    pathPrefix: 'copy.documents.collections',
    requireVersionsEnabled: false,
    warn,
  })
  warnOnEntityOverrides({
    enabledBySlug: globalVersionsBySlug,
    entityName: 'global',
    overrides: copy.documents.globals,
    pathPrefix: 'copy.documents.globals',
    requireVersionsEnabled: false,
    warn,
  })
  warnOnEntityOverrides({
    enabledBySlug: collectionVersionsBySlug,
    entityName: 'collection',
    overrides: copy.versions.collections,
    pathPrefix: 'copy.versions.collections',
    requireVersionsEnabled: true,
    warn,
  })
  warnOnEntityOverrides({
    enabledBySlug: globalVersionsBySlug,
    entityName: 'global',
    overrides: copy.versions.globals,
    pathPrefix: 'copy.versions.globals',
    requireVersionsEnabled: true,
    warn,
  })
}

export const resolveVersionCollectionModes = ({
  copy,
  payload,
}: ResolveVersionCollectionModesArgs): VersionCollectionModes => {
  const versionCollectionModes: VersionCollectionModes = {}

  for (const collection of payload.config.collections || []) {
    if (!collection.versions) {
      continue
    }

    const mode = copy.versions.collections?.[collection.slug] ?? copy.versions.default
    const collectionName = getVersionCollectionName(payload, collection.slug, collection)
    versionCollectionModes[collectionName] = mode
  }

  for (const global of payload.config.globals || []) {
    if (!global.versions) {
      continue
    }

    const mode = copy.versions.globals?.[global.slug] ?? copy.versions.default
    const collectionName = getVersionCollectionName(payload, global.slug, global)
    versionCollectionModes[collectionName] = mode
  }

  return versionCollectionModes
}

export const resolvePayloadCollectionScopes = ({
  copy,
  payload,
}: ResolvePayloadCollectionScopesArgs): PayloadCollectionScopes => {
  const collectionScopes: PayloadCollectionScopes = {}

  for (const collection of payload.config.collections || []) {
    const mode = copy.documents.collections?.[collection.slug] ?? copy.documents.default
    const collectionName = getBaseCollectionName(payload, collection.slug, collection)
    addCollectionScope(collectionScopes, collectionName, { mode })
  }

  const globalsCollectionName = getGlobalsCollectionName(payload)
  for (const global of payload.config.globals || []) {
    const mode = copy.documents.globals?.[global.slug] ?? copy.documents.default
    addCollectionScope(collectionScopes, globalsCollectionName, {
      filter: {
        globalType: global.slug,
      },
      mode,
    })
  }

  return collectionScopes
}

const addCollectionScope = (
  collectionScopes: PayloadCollectionScopes,
  collectionName: string,
  scope: CollectionCopyScope,
) => {
  if (!collectionScopes[collectionName]) {
    collectionScopes[collectionName] = []
  }
  collectionScopes[collectionName].push(scope)
}

const normalizeTargetConfig = (
  config: CopyTargetConfig<CopyMode> | undefined,
  contextPrefix: string,
  maxX: number,
  warn?: (message: string) => void,
): ResolvedCopyTargetConfig<CopyMode> => {
  const targetConfig = config || {}

  const defaultMode = normalizeMode(targetConfig.default || DEFAULT_COPY_MODE, {
    context: `${contextPrefix}.default`,
    maxX,
    warn,
  })

  const collections = normalizeOverrides(
    targetConfig.collections,
    `${contextPrefix}.collections`,
    maxX,
    warn,
  )
  const globals = normalizeOverrides(targetConfig.globals, `${contextPrefix}.globals`, maxX, warn)

  return {
    collections,
    default: defaultMode,
    globals,
  }
}

const normalizeOverrides = (
  overrides: CollectionModeOverrides<CopyMode> | undefined,
  contextPrefix: string,
  maxX: number,
  warn?: (message: string) => void,
) => {
  if (!overrides) {
    return undefined
  }

  const normalized: CollectionModeOverrides<CopyMode> = {}
  for (const slug of Object.keys(overrides)) {
    const mode = overrides[slug]
    if (typeof mode === 'undefined') {
      continue
    }

    normalized[slug] = normalizeMode(mode, {
      context: `${contextPrefix}.${slug}`,
      maxX,
      warn,
    })
  }

  return normalized
}

const normalizeMode = (
  mode: CopyMode,
  options: {
    context: string
    maxX: number
    warn?: (message: string) => void
  },
): CopyMode => {
  if (!mode || typeof mode !== 'object' || typeof mode.mode !== 'string') {
    options.warn?.(
      `\`${options.context}\` must be a valid copy mode. Falling back to { mode: 'all' }.`,
    )
    return { mode: 'all' }
  }

  if (mode.mode === 'all' || mode.mode === 'none') {
    return mode
  }

  if (mode.mode === 'latest-x') {
    if (!Number.isInteger(mode.x) || mode.x < 1) {
      options.warn?.(
        `\`${options.context}.x\` must be an integer greater than or equal to 1. Falling back to { mode: 'all' }.`,
      )
      return { mode: 'all' }
    }

    if (mode.x > options.maxX) {
      options.warn?.(
        `\`${options.context}.x\` (${mode.x}) exceeds the internal maximum (${options.maxX}). Clamping to ${options.maxX}.`,
      )
      return { mode: 'latest-x', x: options.maxX }
    }

    return mode
  }

  options.warn?.(
    `\`${options.context}.mode\` must be one of: "all", "latest-x", "none". Falling back to { mode: 'all' }.`,
  )
  return { mode: 'all' }
}

const coerceVersionMode = (mode: CopyVersionsMode): RuntimeCopyVersionsMode => {
  if (mode.mode === 'none') {
    return { mode: 'latest-x', x: 1 }
  }
  return mode
}

const coerceVersionOverrides = (
  overrides: CollectionModeOverrides<CopyMode> | undefined,
): CollectionModeOverrides<RuntimeCopyVersionsMode> | undefined => {
  if (!overrides) {
    return undefined
  }

  const coerced: CollectionModeOverrides<RuntimeCopyVersionsMode> = {}
  for (const slug of Object.keys(overrides)) {
    const mode = overrides[slug]
    if (typeof mode === 'undefined') {
      continue
    }

    coerced[slug] = coerceVersionMode(mode)
  }

  return coerced
}

const warnOnEntityOverrides = ({
  enabledBySlug,
  entityName,
  overrides,
  pathPrefix,
  requireVersionsEnabled,
  warn,
}: {
  enabledBySlug: Map<string, boolean>
  entityName: 'collection' | 'global'
  overrides: CollectionModeOverrides<CopyMode> | undefined
  pathPrefix: string
  requireVersionsEnabled: boolean
  warn?: (message: string) => void
}) => {
  if (!overrides) {
    return
  }

  for (const slug of Object.keys(overrides)) {
    if (!enabledBySlug.has(slug)) {
      warn?.(`\`${pathPrefix}.${slug}\` does not match any configured ${entityName} slug.`)
      continue
    }

    if (requireVersionsEnabled && !enabledBySlug.get(slug)) {
      warn?.(
        `\`${pathPrefix}.${slug}\` is set, but ${entityName} "${slug}" does not have versions enabled.`,
      )
    }
  }
}

const getVersionCollectionName = (
  payload: Payload,
  slug: string,
  config: {
    dbName?: ((args: Record<string, never>) => string) | string
    name?: string
    slug: string
  },
) => {
  const versionModel = (
    payload.db as { versions?: Record<string, { collection?: { name?: string } }> }
  ).versions?.[slug]
  const modelCollectionName = versionModel?.collection?.name
  if (modelCollectionName) {
    return modelCollectionName
  }

  const dbName = resolveDBName(config)
  return `_${dbName}_versions`
}

const getBaseCollectionName = (
  payload: Payload,
  slug: string,
  config: {
    dbName?: ((args: Record<string, never>) => string) | string
    name?: string
    slug: string
  },
) => {
  const collectionModel = (
    payload.db as {
      collections?: Record<string, { collection?: { name?: string } }>
    }
  ).collections?.[slug]
  const modelCollectionName = collectionModel?.collection?.name
  if (modelCollectionName) {
    return modelCollectionName
  }

  return resolveDBName(config)
}

const getGlobalsCollectionName = (payload: Payload): string => {
  const globalsModel = payload.db as { globals?: { collection?: { name?: string } } }
  const modelCollectionName = globalsModel.globals?.collection?.name
  if (modelCollectionName) {
    return modelCollectionName
  }

  return 'globals'
}

const resolveDBName = (config: {
  dbName?: ((args: Record<string, never>) => string) | string
  name?: string
  slug: string
}) => {
  if (typeof config.dbName === 'function') {
    return config.dbName({})
  }
  if (typeof config.dbName === 'string' && config.dbName.length > 0) {
    return config.dbName
  }
  if (typeof config.name === 'string' && config.name.length > 0) {
    return config.name
  }

  return config.slug
}

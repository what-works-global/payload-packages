import type { CollectionConfig, GlobalConfig, Payload } from 'payload'

import type {
  CopyConfig,
  CopyDocumentsMode,
  CopyModeOverrides,
  CopyTargetConfig,
  CopyVersionsMode,
  UnregisteredCopyConfig,
} from '../types.js'

type CopyMode = CopyDocumentsMode
type RuntimeCopyVersionsMode = Exclude<CopyVersionsMode, { mode: 'none' }>
const DEFAULT_COPY_MODE: CopyMode = { mode: 'all' }
/** Unregistered collections are opt-in: skipped unless configured otherwise. */
const DEFAULT_UNREGISTERED_COPY_MODE: CopyMode = { mode: 'none' }
const INTERNAL_MAX_LATEST_X = 100
/** Payload names a version collection `_<base>_versions` on the mongo adapter. */
const VERSION_COLLECTION_NAME_PATTERN = /^_.+_versions$/

type CollectionModeOverrides<TMode extends CopyMode> = CopyModeOverrides<string, TMode>
type GlobalModeOverrides<TMode extends CopyMode> = CopyModeOverrides<string, TMode>

export interface ResolvedCopyTargetConfig<TMode extends CopyMode> {
  collections?: CollectionModeOverrides<TMode>
  default: TMode
  globals?: GlobalModeOverrides<TMode>
}

export interface ResolvedUnregisteredCopyConfig {
  collections?: CollectionModeOverrides<CopyDocumentsMode>
  default: CopyDocumentsMode
  /**
   * Applied to unregistered *version* collections that no override names, so a
   * bounded versions copy stays bounded for unregistered collections too.
   * Inherited from `copy.versions.default`.
   */
  versionsDefault: RuntimeCopyVersionsMode
}

export interface ResolvedCopyConfig {
  documents: ResolvedCopyTargetConfig<CopyDocumentsMode>
  unregistered: ResolvedUnregisteredCopyConfig
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

interface ResolveUnregisteredCopyTargetsArgs {
  /** Collection names that exist in the source database. */
  existingCollectionNames: Iterable<string>
  /**
   * Database collection names already covered by a registered collection,
   * global, or version collection — these are handled by `copy.documents` /
   * `copy.versions` and must not be re-added here.
   */
  registeredCollectionNames: Iterable<string>
  unregistered: ResolvedUnregisteredCopyConfig | undefined
}

export interface UnregisteredCopyTargets {
  collectionScopes: PayloadCollectionScopes
  versionCollectionModes: VersionCollectionModes
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
  const versionsDefault = coerceVersionMode(normalizedVersions.default)

  return {
    documents: normalizeTargetConfig(fromObject.documents, 'copy.documents', maxX, warn),
    unregistered: normalizeUnregisteredConfig({
      config: fromObject.unregistered,
      maxX,
      versionsDefault,
      warn,
    }),
    versions: {
      collections: coerceVersionOverrides(normalizedVersions.collections),
      default: versionsDefault,
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
  warnOnUnregisteredOverrides({ collections, copy, warn })
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
  const registeredGlobalSlugs: string[] = []
  for (const global of payload.config.globals || []) {
    const mode = copy.documents.globals?.[global.slug] ?? copy.documents.default
    registeredGlobalSlugs.push(global.slug)
    addCollectionScope(collectionScopes, globalsCollectionName, {
      filter: {
        globalType: global.slug,
      },
      mode,
    })
  }

  // Every global lives in the single `globals` collection, so a global this
  // config doesn't register is invisible to the per-slug scopes above — the
  // collection itself is registered, so the unregistered-collection pass never
  // sees it either. Add a scope for the leftovers when unregistered copying is
  // on, so a sibling deployment's globals survive the copy.
  const unregisteredGlobalsMode =
    copy.unregistered.collections?.[globalsCollectionName] ?? copy.unregistered.default
  if (registeredGlobalSlugs.length > 0 && unregisteredGlobalsMode.mode !== 'none') {
    addCollectionScope(collectionScopes, globalsCollectionName, {
      filter: {
        globalType: { $nin: registeredGlobalSlugs },
      },
      mode: unregisteredGlobalsMode,
    })
  }

  return collectionScopes
}

/**
 * Splits the source database's leftover collections — the ones no registered
 * collection, global, or version collection maps to — into base-document scopes
 * and version-collection modes, according to `copy.unregistered`.
 *
 * Nothing is returned unless the caller opted in: with the default
 * `{ mode: 'none' }` and no overrides, unregistered collections stay skipped.
 */
export const resolveUnregisteredCopyTargets = ({
  existingCollectionNames,
  registeredCollectionNames,
  unregistered,
}: ResolveUnregisteredCopyTargetsArgs): UnregisteredCopyTargets => {
  const targets: UnregisteredCopyTargets = {
    collectionScopes: {},
    versionCollectionModes: {},
  }

  if (!unregistered) {
    return targets
  }

  const registered = new Set(registeredCollectionNames)

  for (const collectionName of existingCollectionNames) {
    if (registered.has(collectionName) || isInternalDatabaseCollectionName(collectionName)) {
      continue
    }

    const override = unregistered.collections?.[collectionName]
    const mode = override ?? unregistered.default
    if (mode.mode === 'none') {
      continue
    }

    if (VERSION_COLLECTION_NAME_PATTERN.test(collectionName)) {
      // Sized like a registered collection's versions (latest-x is per parent),
      // so `copy.versions.default` still bounds the copy. An override naming
      // this collection wins.
      targets.versionCollectionModes[collectionName] = override
        ? coerceVersionMode(override)
        : unregistered.versionsDefault
      continue
    }

    addCollectionScope(targets.collectionScopes, collectionName, { mode })
  }

  return targets
}

/**
 * MongoDB's own bookkeeping collections (`system.views`, `system.profile`, ...).
 * They are server-managed and can't be inserted into, so they must never be
 * treated as copyable data.
 */
const isInternalDatabaseCollectionName = (collectionName: string): boolean =>
  collectionName.startsWith('system.')

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
  fallback?: CopyMode,
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
      fallback,
      maxX,
      warn,
    })
  }

  return normalized
}

const normalizeUnregisteredConfig = ({
  config,
  maxX,
  versionsDefault,
  warn,
}: {
  config: undefined | UnregisteredCopyConfig
  maxX: number
  versionsDefault: RuntimeCopyVersionsMode
  warn?: (message: string) => void
}): ResolvedUnregisteredCopyConfig => {
  const unregisteredConfig = config || {}
  const contextPrefix = 'copy.unregistered'

  return {
    collections: normalizeOverrides(
      unregisteredConfig.collections,
      `${contextPrefix}.collections`,
      maxX,
      warn,
      DEFAULT_UNREGISTERED_COPY_MODE,
    ),
    default: normalizeMode(unregisteredConfig.default || DEFAULT_UNREGISTERED_COPY_MODE, {
      context: `${contextPrefix}.default`,
      fallback: DEFAULT_UNREGISTERED_COPY_MODE,
      maxX,
      warn,
    }),
    versionsDefault,
  }
}

const normalizeMode = (
  mode: CopyMode,
  options: {
    context: string
    /**
     * Mode used when the configured one is invalid. `{ mode: 'all' }` everywhere
     * except `copy.unregistered`, where invalid input must not silently opt the
     * copy into collections it was never meant to include.
     */
    fallback?: CopyMode
    maxX: number
    warn?: (message: string) => void
  },
): CopyMode => {
  const fallback = options.fallback ?? { mode: 'all' }

  if (!mode || typeof mode !== 'object' || typeof mode.mode !== 'string') {
    options.warn?.(
      `\`${options.context}\` must be a valid copy mode. Falling back to { mode: '${fallback.mode}' }.`,
    )
    return fallback
  }

  if (mode.mode === 'all' || mode.mode === 'none') {
    return mode
  }

  if (mode.mode === 'latest-x') {
    if (!Number.isInteger(mode.x) || mode.x < 1) {
      options.warn?.(
        `\`${options.context}.x\` must be an integer greater than or equal to 1. Falling back to { mode: '${fallback.mode}' }.`,
      )
      return fallback
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
    `\`${options.context}.mode\` must be one of: "all", "latest-x", "none". Falling back to { mode: '${fallback.mode}' }.`,
  )
  return fallback
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

/**
 * `copy.unregistered.collections` is keyed by database collection name and only
 * ever reaches collections this config does *not* register, so an entry naming a
 * registered collection is a silent no-op — the user most likely meant
 * `copy.documents.collections` (which is keyed by slug).
 */
const warnOnUnregisteredOverrides = ({
  collections,
  copy,
  warn,
}: {
  collections: CollectionConfig[]
  copy: ResolvedCopyConfig
  warn?: (message: string) => void
}) => {
  const overrides = copy.unregistered.collections
  if (!overrides) {
    return
  }

  const registeredNames = new Map<string, string>()
  for (const collection of collections) {
    registeredNames.set(collection.slug, collection.slug)
    registeredNames.set(resolveDBName(collection), collection.slug)
  }

  for (const collectionName of Object.keys(overrides)) {
    const slug = registeredNames.get(collectionName)
    if (slug) {
      warn?.(
        `\`copy.unregistered.collections.${collectionName}\` matches the configured collection "${slug}", so it has no effect. Use \`copy.documents.collections.${slug}\` instead.`,
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

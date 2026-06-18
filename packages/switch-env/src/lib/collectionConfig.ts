import path from 'path'
import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
  type CollectionConfig,
  type CollectionSlug,
  type Config,
  type Field,
  type PayloadRequest,
  type SanitizedCollectionConfig,
  type SanitizedConfig,
  type TextField,
  traverseFields,
} from 'payload'

import type {
  DevelopmentFileStorageArgs,
  DevelopmentFileStorageMode,
  Env,
  GetEnv,
} from '../types.js'

import { developmentStorageModeFieldName } from './developmentFileStorage.js'
import { getModifiedHandler } from './handlers.js'
import {
  getModifiedAdminThumbnail,
  getModifiedAfterReadHook as getModifiedThumbnailUrlAfterReadHook,
} from './thumbnailUrl.js'

export const addAccessSettingsToUploadCollection = (
  collection: CollectionConfig,
  getEnv: GetEnv,
): CollectionConfig => {
  if (collection.upload === true || typeof collection.upload === 'object') {
    return {
      ...collection,
      access: {
        ...(collection.access || {}),
        delete: async (args) => {
          const oldDelete = collection.access?.delete
          const result = oldDelete ? await oldDelete(args) : true
          const env = await getEnv(args.req.payload)
          if (env === 'development') {
            if (args.data) {
              return !!args.data.createdDuringDevelopment
            } else {
              const access = !(await operatingOnAnyDocumentNotCreatedDuringDevelopment(
                args.req,
                collection.slug,
                args.id?.toString(),
              ))
              if (!access) {
                throw new APIError(
                  'Cannot delete upload collection documents that were not created during development, as it will delete the file(s) in cloud storage.',
                )
              }
              return result
            }
          }
          return result
        },
        update: async (args) => {
          const oldUpdate = collection.access?.update
          const result = oldUpdate ? await oldUpdate(args) : true
          const env = await getEnv(args.req.payload)
          if (env === 'development') {
            if (args.data) {
              return !!args.data.createdDuringDevelopment
            } else {
              const access = !(await operatingOnAnyDocumentNotCreatedDuringDevelopment(
                args.req,
                collection.slug,
                args.id?.toString(),
              ))
              if (!access) {
                throw new APIError(
                  'Cannot update upload collection documents that were not created during development, as it will potentially modify the file(s) in cloud storage.',
                )
              }
              return result
            }
          }
          return result
        },
      },
    }
  }
  return collection
}

/**
 * True when payload's CLI is generating or running a migration
 * (`payload migrate`, `payload migrate:create`, `migrate:down`, …).
 *
 * The compound `(filename, prefix)` index is a development cloud-storage
 * *runtime* reshape, not part of the canonical schema migrations describe.
 * Migrations represent the production / file-system baseline, where filename
 * uniqueness is the single-field `filename` unique index payload builds by
 * default; the compound index is applied to the development database at runtime
 * by the schema push `restore` runs after a copy. If `filenameCompoundIndex`
 * were left set while `payload migrate:create` diffs the schema, the generated
 * migration would drop that unique index and add the compound one — and that
 * migration runs against production. Suppressing it during migration commands
 * keeps generated migrations clean no matter which environment they are authored
 * in (e.g. with `APP_ENV=staging` active), while the runtime config — which has
 * no migrate command in argv — still declares it so the push picks it up.
 *
 * Detected the way payload's own bin resolves the command (bin/index.js): the
 * first positional CLI argument, lowercased, starting with "migrate". Payload
 * exposes no first-class "is migrating" signal, and the config is built
 * synchronously inside that CLI process, so `process.argv` is the available,
 * stable indicator.
 */
const isGeneratingMigration = (): boolean => {
  const command = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  return command?.toLowerCase().startsWith('migrate') ?? false
}

export const addDevelopmentSettingsToUploadCollection = <
  T extends CollectionConfig | SanitizedCollectionConfig,
>(
  collection: T,
  getEnv: GetEnv,
  developmentFileStorage: DevelopmentFileStorageArgs,
  payloadVersion: string | undefined,
): T => {
  if (collection.upload === true) {
    collection.upload = {}
  }
  if (collection.upload) {
    if (
      developmentFileStorage.mode === 'cloud-storage' &&
      !collection.upload.filenameCompoundIndex &&
      !isGeneratingMigration()
    ) {
      const collectionOptions = developmentFileStorage.collections[collection.slug]
      if (typeof collectionOptions === 'object' && collectionOptions.prefix) {
        // Development and copied-production documents share a database under
        // different storage prefixes, and payload's duplicate-filename check is
        // scoped to the incoming prefix. Scope the unique index the same way:
        // the same filename under different prefixes is two distinct storage
        // keys, while duplicates within a prefix still deduplicate (-1, -2, ...).
        // Skipped during migration generation — see isGeneratingMigration.
        collection.upload.filenameCompoundIndex = ['filename', 'prefix']
      }
    }
    if (!collection.upload.handlers) {
      collection.upload.handlers = []
    }
    // Payload validates client uploads by reading the file back from cloud storage
    // (addDataAndFileToRequest). The signed-URL upload key is computed from the live
    // collection options — which switchEnvironments has already rewritten to include the
    // development prefix — but the storage adapter's staticHandler captured the original
    // collection prefix in a closure before this plugin ran. Without intervention the
    // read-back resolves a stale key, gets no file, and mimeTypes validation fails.
    //
    // What clientUploadContext.prefix carries changed in payload 3.83.0 (#16230):
    // - < 3.83.0: the collection prefix (captured at build time, missing the development
    //   prefix), so joining the development prefix onto it yields the uploaded key.
    // - >= 3.83.0: the doc prefix (normally empty). A non-empty doc prefix replaces the
    //   collection prefix entirely in the key computation (non-composite mode), so mirror
    //   the signed-URL logic instead: leave a non-empty doc prefix untouched, otherwise
    //   pin it to the rewritten collection prefix.
    const contextCarriesDocPrefix = isPayloadAtLeast(payloadVersion, '3.83.0')
    collection.upload.handlers.unshift(async (req, args) => {
      if ('clientUploadContext' in args.params) {
        const env = await getEnv(req.payload)
        if (env === 'development' && developmentFileStorage.mode === 'cloud-storage') {
          const clientUploadContext = args.params.clientUploadContext as {
            prefix?: string
          }
          if (!contextCarriesDocPrefix) {
            clientUploadContext.prefix = path.posix.join(
              developmentFileStorage.prefix,
              clientUploadContext.prefix || '',
            )
          } else if (!clientUploadContext.prefix) {
            const collectionOptions = developmentFileStorage.collections[collection.slug]
            if (
              typeof collectionOptions === 'object' &&
              typeof collectionOptions.prefix === 'string' &&
              collectionOptions.prefix
            ) {
              clientUploadContext.prefix = collectionOptions.prefix
            }
          }
        }
      }
    })
    const developmentFileStorageMode = developmentFileStorage.mode
    const fields: Field[] = [
      ...(collection.fields || []),
      {
        name: 'createdDuringDevelopment',
        type: 'checkbox',
        admin: {
          hidden: true,
        },
        defaultValue: false,
      },
      {
        name: developmentStorageModeFieldName,
        type: 'text',
        admin: {
          hidden: true,
        },
      },
    ]
    if (developmentFileStorageMode === 'file-system') {
      traverseFields({
        callback: ({ field }) => {
          if (field.type === 'text' && (field.name == 'url' || field.name == 'thumbnailURL')) {
            const afterReadHooks = field.hooks?.afterRead
            if (afterReadHooks && afterReadHooks.length > 0) {
              const oldAfterReadHook = afterReadHooks.shift()!
              afterReadHooks.unshift(getModifiedThumbnailUrlAfterReadHook(oldAfterReadHook))
            }
          }
        },
        fields,
      })
    }
    return {
      ...collection,
      fields,
      hooks: {
        ...(collection.hooks || {}),
        beforeOperation: [
          getDevelopmentBeforeOperationHook(collection.slug, getEnv, developmentFileStorage),
          ...(collection.hooks?.beforeOperation || []),
        ],
      },
    }
  }
  return collection
}

/**
 * Marks documents created in development and applies the development storage
 * prefix to incoming data.
 *
 * This must be a beforeOperation hook, not beforeChange: payload's duplicate
 * filename check (generateFileData -> getSafeFileName) runs before any
 * beforeChange hook and filters its lookup by the incoming data.prefix. With
 * the development prefix already applied here, that check sees the same prefix
 * new documents are stored under, so duplicate filenames get deduplicated
 * (-1, -2, ...) instead of tripping the collection-wide unique filename index.
 */
const getDevelopmentBeforeOperationHook = (
  collectionSlug: string,
  getEnv: GetEnv,
  developmentFileStorage: DevelopmentFileStorageArgs,
): CollectionBeforeOperationHook => {
  return async ({ args, operation, req }) => {
    if (operation !== 'create' || !args.data) {
      return args
    }
    const env = await getEnv(req.payload)
    if (env !== 'development') {
      return args
    }
    const data = args.data as Record<string, unknown>
    data.createdDuringDevelopment = true
    data[developmentStorageModeFieldName] = developmentFileStorage.mode
    if (developmentFileStorage.mode === 'cloud-storage' && developmentFileStorage.prefix) {
      if (typeof data.prefix === 'string' && data.prefix) {
        data.prefix = prependPathPrefixIfMissing(data.prefix, developmentFileStorage.prefix)
      } else {
        // No prefix in the incoming data (the field's baked defaultValue only
        // applies later, during beforeValidate) — pin it to this plugin's
        // already-rewritten copy of the collection prefix, like the client
        // upload endpoints do.
        const collectionOptions = developmentFileStorage.collections[collectionSlug]
        data.prefix =
          (typeof collectionOptions === 'object' && collectionOptions.prefix) ||
          developmentFileStorage.prefix
      }
    }
    return args
  }
}

/**
 * Toggles whether files get saved to local storage on upload
 */
export const toggleLocalStorage = <T extends CollectionConfig | SanitizedCollectionConfig>(
  collection: T,
  enabled: boolean,
): T => {
  collection.upload = {
    ...(typeof collection.upload === 'object' && collection.upload),
    disableLocalStorage: !enabled,
  }
  return collection
}

interface UploadHooks {
  afterDeleteHook: CollectionAfterDeleteHook
  changeHook: CollectionAfterChangeHook | CollectionBeforeChangeHook
}

const hooks: Record<CollectionSlug, UploadHooks> = {}
type CloudStorageUploadHookPhase = 'afterChange' | 'beforeChange'

const hasLeadingPathPrefix = (value: string, prefix: string): boolean =>
  value === prefix || value.startsWith(`${prefix}/`)

const prependPathPrefixIfMissing = (value: string, prefix: string): string => {
  if (!prefix || hasLeadingPathPrefix(value, prefix)) {
    return value
  }
  return path.posix.join(prefix, value)
}

const removeLeadingPathPrefix = (value: string, prefix: string): string => {
  if (!prefix) {
    return value
  }
  if (value === prefix) {
    return ''
  }
  if (value.startsWith(`${prefix}/`)) {
    return value.slice(prefix.length + 1)
  }
  return value
}

const parseVersionPart = (part: string): number => {
  const match = part.match(/^\d+/)
  return match ? Number(match[0]) : 0
}

const isPayloadAtLeast = (payloadVersion: string | undefined, minVersion: string): boolean => {
  // An unknown version means neither an explicit `payloadVersion` was passed nor
  // could one be detected — assume a current payload release.
  if (payloadVersion === undefined) {
    return true
  }
  const [currentMajor = '0', currentMinor = '0', currentPatch = '0'] = payloadVersion.split('.')
  const [minMajor = '0', minMinor = '0', minPatch = '0'] = minVersion.split('.')
  const current = [
    parseVersionPart(currentMajor),
    parseVersionPart(currentMinor),
    parseVersionPart(currentPatch),
  ]
  const target = [
    parseVersionPart(minMajor),
    parseVersionPart(minMinor),
    parseVersionPart(minPatch),
  ]

  for (let i = 0; i < target.length; i++) {
    if (current[i] > target[i]) {
      return true
    }
    if (current[i] < target[i]) {
      return false
    }
  }

  return true
}

const getCloudStorageUploadHookPhase = (
  payloadVersion: string | undefined,
): CloudStorageUploadHookPhase =>
  isPayloadAtLeast(payloadVersion, '3.70.0') ? 'afterChange' : 'beforeChange'

const getChangeHooks = <T extends CollectionConfig | SanitizedCollectionConfig>(
  collection: T,
  cloudStorageUploadHookPhase: CloudStorageUploadHookPhase,
): (CollectionAfterChangeHook | CollectionBeforeChangeHook)[] => {
  if (cloudStorageUploadHookPhase === 'afterChange') {
    return collection.hooks?.afterChange || []
  }
  return collection.hooks?.beforeChange || []
}

const setChangeHooks = (
  hooksConfig: NonNullable<CollectionConfig['hooks']>,
  changeHooks: (CollectionAfterChangeHook | CollectionBeforeChangeHook)[],
  cloudStorageUploadHookPhase: CloudStorageUploadHookPhase,
) => {
  if (cloudStorageUploadHookPhase === 'afterChange') {
    hooksConfig.afterChange = changeHooks as CollectionAfterChangeHook[]
  } else {
    hooksConfig.beforeChange = changeHooks as CollectionBeforeChangeHook[]
  }
}

/**
 * Prevents files from being uploaded or deleted by removing those hooks in development.
 * Payload >=3.70.0 moved the cloud-storage upload hook from beforeChange to afterChange.
 */
const toggleCollectionHooks = <T extends CollectionConfig | SanitizedCollectionConfig>(
  collection: T,
  enabled: boolean,
  cloudStorageUploadHookPhase: CloudStorageUploadHookPhase,
): T => {
  if (enabled) {
    if (hooks[collection.slug]) {
      const changeHooks = getChangeHooks(collection, cloudStorageUploadHookPhase)
      const hooksConfig = {
        ...(collection.hooks || {}),
        afterDelete: [
          ...(collection.hooks?.afterDelete || []),
          hooks[collection.slug].afterDeleteHook,
        ],
      } satisfies NonNullable<CollectionConfig['hooks']>
      setChangeHooks(
        hooksConfig,
        [...changeHooks, hooks[collection.slug].changeHook],
        cloudStorageUploadHookPhase,
      )
      collection.hooks = {
        ...hooksConfig,
      }
      delete hooks[collection.slug]
    }
  } else {
    const changeHooks = getChangeHooks(collection, cloudStorageUploadHookPhase)
    const afterDeleteHooks = collection.hooks?.afterDelete || []
    const changeHook = changeHooks.at(-1)
    const afterDeleteHook = afterDeleteHooks.at(-1)
    if (changeHook && afterDeleteHook) {
      hooks[collection.slug] = {
        afterDeleteHook,
        changeHook,
      }
      changeHooks.pop()
      afterDeleteHooks.pop()
    }
  }
  return collection
}

type UploadProviderClientProps = {
  enabled?: boolean
  serverHandlerPath?: unknown
}

type UploadProvider = {
  clientProps?: UploadProviderClientProps
}

const hasUploadProviderClientProps = (provider: unknown): provider is UploadProvider => {
  if (!provider || typeof provider !== 'object') {
    return false
  }
  const clientProps = (provider as UploadProvider).clientProps
  if (!clientProps || typeof clientProps !== 'object') {
    return false
  }
  return 'serverHandlerPath' in clientProps
}

/**
 * If using clientUploads config, this will ensure that files don't
 * get directly uploaded to cloud storage using signed urls
 */
export const toggleUploadProviders = (
  config: Config | SanitizedConfig,
  env: Env,
  developmentFileStorageMode: DevelopmentFileStorageMode,
) => {
  const providers = config.admin?.components?.providers
  if (!Array.isArray(providers) || providers.length === 0) {
    return
  }

  const enabled = env === 'production' || developmentFileStorageMode === 'cloud-storage'
  providers.forEach((provider) => {
    if (hasUploadProviderClientProps(provider)) {
      provider.clientProps = {
        ...provider.clientProps,
        enabled,
      }
    }
  })
}

const wrappedClientUploadHandlers = new WeakSet<object>()

/**
 * Payload >= 3.83.0 (#16230) sends the doc `prefix` field value as `docPrefix` with
 * client uploads, and a non-empty docPrefix replaces the collection prefix in the
 * storage key computation. The default doc prefix is baked from the original
 * collection prefix at config build time — before this plugin rewrites prefixes —
 * so signed-URL uploads would land outside the development prefix while the stored
 * doc (and thus the generated URL) carries it.
 *
 * Wrap the cloud-storage plugin's signed-URL endpoint(s) — located via the
 * serverHandlerPath that initClientUploads stores on the admin providers — and pin
 * the development prefix onto docPrefix at request time. This covers default,
 * user-defined, and function-generated doc prefixes, and (because docPrefix
 * overrides the collection prefix) makes the upload key independent of the storage
 * plugin's own, possibly unrewritten, collection prefix. Payload < 3.83.0 ignores
 * docPrefix entirely, so the rewrite is harmless there.
 */
export const wrapClientUploadEndpoints = (
  config: Config | SanitizedConfig,
  getEnv: GetEnv,
  developmentFileStorage: DevelopmentFileStorageArgs,
) => {
  if (developmentFileStorage.mode !== 'cloud-storage') {
    return
  }
  const providers = config.admin?.components?.providers
  if (!Array.isArray(providers)) {
    return
  }
  const serverHandlerPaths = new Set<string>()
  providers.forEach((provider) => {
    if (hasUploadProviderClientProps(provider)) {
      const serverHandlerPath = provider.clientProps?.serverHandlerPath
      if (typeof serverHandlerPath === 'string') {
        serverHandlerPaths.add(serverHandlerPath)
      }
    }
  })
  if (serverHandlerPaths.size === 0) {
    return
  }
  config.endpoints?.forEach((endpoint) => {
    if (
      !endpoint.path ||
      !serverHandlerPaths.has(endpoint.path) ||
      endpoint.method !== 'post' ||
      wrappedClientUploadHandlers.has(endpoint.handler)
    ) {
      return
    }
    const originalHandler = endpoint.handler
    const handler: typeof originalHandler = async (req) => {
      const env = await getEnv(req.payload)
      if (env === 'development' && typeof req.json === 'function') {
        const body = (await req.json()) as {
          collectionSlug?: string
          docPrefix?: string
        } | null
        if (body && typeof body === 'object') {
          if (typeof body.docPrefix === 'string' && body.docPrefix) {
            body.docPrefix = prependPathPrefixIfMissing(
              body.docPrefix,
              developmentFileStorage.prefix,
            )
          } else if (typeof body.collectionSlug === 'string') {
            // An empty docPrefix falls back to the storage plugin's own collection
            // prefix, which may predate the development rewrite — pin it to this
            // plugin's (rewritten) copy instead.
            const collectionOptions = developmentFileStorage.collections[body.collectionSlug]
            if (
              typeof collectionOptions === 'object' &&
              typeof collectionOptions.prefix === 'string' &&
              collectionOptions.prefix
            ) {
              body.docPrefix = collectionOptions.prefix
            }
          }
        }
        req.json = () => Promise.resolve(body)
      }
      return originalHandler(req)
    }
    wrappedClientUploadHandlers.add(handler)
    endpoint.handler = handler
  })
}

export const modifyThumbnailUrl = (config: Config | SanitizedConfig, getEnv: GetEnv) => {
  const collections = (config.collections || []) as (CollectionConfig | SanitizedCollectionConfig)[]
  collections
    .filter((c) => c.upload)
    .forEach((collection) => {
      const fields =
        'flattenedFields' in collection ? collection.flattenedFields : collection.fields
      const thumbnailUrlField = fields.find(
        (field) => field.type === 'text' && field.name === 'thumbnailURL',
      ) as TextField
      if (thumbnailUrlField) {
        const afterReadHooks = thumbnailUrlField.hooks?.afterRead
        if (afterReadHooks && afterReadHooks.length > 0) {
          const oldAfterReadHook = afterReadHooks.shift()!
          afterReadHooks.unshift(getModifiedThumbnailUrlAfterReadHook(oldAfterReadHook))
        }
      }
      if (typeof collection.upload === 'boolean' && collection.upload) {
        collection.upload = {}
      }
      if (collection.upload) {
        const handlers =
          typeof collection.upload === 'object' && Array.isArray(collection.upload.handlers)
            ? collection.upload.handlers
            : []
        if (handlers.length > 0) {
          const handler = handlers.pop()
          if (handler) {
            handlers.push(getModifiedHandler(handler, getEnv))
          }
        }
        const adminThumbnail =
          typeof collection.upload === 'object' ? collection.upload.adminThumbnail : undefined
        if (adminThumbnail) {
          collection.upload.adminThumbnail = getModifiedAdminThumbnail(
            adminThumbnail,
            config,
            collection,
          )
        }
      }
    })
}

export const switchEnvironments = (
  config: Config | SanitizedConfig,
  env: Env,
  developmentFileStorage: DevelopmentFileStorageArgs,
  payloadVersion: string | undefined,
) => {
  if (developmentFileStorage.mode === 'cloud-storage') {
    Object.values(developmentFileStorage.collections).forEach((collectionOptions) => {
      if (typeof collectionOptions === 'object' && typeof collectionOptions.prefix === 'string') {
        const devPrefix = developmentFileStorage.prefix
        if (env === 'development') {
          collectionOptions.prefix = prependPathPrefixIfMissing(
            collectionOptions.prefix || '',
            devPrefix,
          )
        } else {
          collectionOptions.prefix = removeLeadingPathPrefix(collectionOptions.prefix, devPrefix)
        }
      }
    })
  }
  modifyUploadCollections(config.collections || [], env, developmentFileStorage, payloadVersion)
  toggleUploadProviders(config, env, developmentFileStorage.mode)
}

export const modifyUploadCollections = (
  collections: (CollectionConfig | SanitizedCollectionConfig)[],
  env: Env,
  developmentFileStorage: DevelopmentFileStorageArgs,
  payloadVersion: string | undefined,
) => {
  const production = env === 'production'
  const cloudStorageUploadHookPhase = getCloudStorageUploadHookPhase(payloadVersion)
  collections
    .filter((c) => c.upload)
    .forEach((collection) => {
      toggleCollectionHooks(
        collection,
        production || developmentFileStorage.mode === 'cloud-storage',
        cloudStorageUploadHookPhase,
      )
      toggleLocalStorage(collection, !production && developmentFileStorage.mode === 'file-system')
    })
}

const operatingOnAnyDocumentNotCreatedDuringDevelopment = async (
  req: PayloadRequest,
  collectionSlug: CollectionSlug,
  id?: string,
) => {
  const documentIds = Array.from(req.searchParams.entries())
    .filter(([key, _]) => key.includes('id'))
    .map(([_, value]) => value)

  if (id) {
    documentIds.push(id)
  }

  if (documentIds.length == 0) {
    return false
  }
  const documents = await req.payload.find({
    collection: collectionSlug,
    where: {
      id: { in: documentIds },
    },
  })
  return documents.docs.some(
    (doc) =>
      typeof doc.createdDuringDevelopment !== 'boolean' || doc.createdDuringDevelopment === false,
  )
}

import path from 'path'
import {
  APIError,
  type BasePayload,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeChangeHook,
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

export const addDevelopmentSettingsToUploadCollection = <
  T extends CollectionConfig | SanitizedCollectionConfig,
>(
  collection: T,
  getEnv: GetEnv,
  developmentFileStorage: DevelopmentFileStorageArgs,
): T => {
  if (collection.upload === true) {
    collection.upload = {}
  }
  if (collection.upload) {
    if (!collection.upload.handlers) {
      collection.upload.handlers = []
    }
    // See
    collection.upload.handlers.unshift(async (req, args) => {
      if ('clientUploadContext' in args.params) {
        const env = await getEnv(req.payload)
        if (env === 'development' && developmentFileStorage.mode === 'cloud-storage') {
          const clientUploadContext = args.params.clientUploadContext as {
            prefix?: string
          }
          clientUploadContext.prefix = path.posix.join(
            developmentFileStorage.prefix,
            clientUploadContext.prefix || '',
          )
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
        beforeChange: [
          async ({ data, operation, req: { payload } }) => {
            const env = await getEnv(payload)
            if (operation === 'create' && env === 'development' && data) {
              data.createdDuringDevelopment = true
              data[developmentStorageModeFieldName] = developmentFileStorage.mode
            }
            return data
          },
          getModifiedPrefixBeforeChangeHook(developmentFileStorage),
          ...(collection.hooks?.beforeChange || []),
        ],
      },
    }
  }
  return collection
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

const isPayloadAtLeast = (payloadVersion: string, minVersion: string): boolean => {
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

const getCloudStorageUploadHookPhase = (payloadVersion: string): CloudStorageUploadHookPhase =>
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
        const handlers = [
          ...(typeof collection.upload === 'object' && Array.isArray(collection.upload.handlers)
            ? collection.upload.handlers
            : []),
        ]
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

const getModifiedPrefixBeforeChangeHook = (
  developmentFileStorage: DevelopmentFileStorageArgs,
): CollectionBeforeChangeHook => {
  return (args) => {
    const { data, originalDoc } = args
    const isDevelopmentDoc =
      data?.createdDuringDevelopment === true || originalDoc?.createdDuringDevelopment === true

    if (isDevelopmentDoc) {
      if (developmentFileStorage.mode === 'cloud-storage' && developmentFileStorage.prefix) {
        data.prefix = prependPathPrefixIfMissing(data.prefix || '', developmentFileStorage.prefix)
      }
    }
    return data
  }
}

export const modifyPrefix = <T extends CollectionConfig | SanitizedCollectionConfig>(
  collection: T,
  developmentFileStorage: DevelopmentFileStorageArgs,
): T => {
  if (collection.upload) {
    collection.hooks = {
      ...(collection.hooks || {}),
      beforeChange: [
        getModifiedPrefixBeforeChangeHook(developmentFileStorage),
        ...(collection.hooks?.beforeChange || []),
      ],
    }
  }
  return collection
}

export const switchEnvironments = (
  config: Config | SanitizedConfig,
  env: Env,
  developmentFileStorage: DevelopmentFileStorageArgs,
  payloadVersion: string,
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
  payloadVersion: string,
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

import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
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
import {
  getCollectionPrefix,
  getDevelopmentPrefixPlacement,
  toDevelopmentPrefix,
} from './developmentPrefix.js'
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
            const { allowed, identifiedDocuments } = await checkDevelopmentUploadWrite(
              args,
              collection.slug,
            )
            if (!allowed) {
              if (identifiedDocuments && isMutationRequest(args.req)) {
                throw new APIError(
                  'Cannot delete upload collection documents that were not created during development, as it will delete the file(s) in cloud storage.',
                  403,
                  null,
                  true,
                )
              }
              return false
            }
          }
          return result
        },
        update: async (args) => {
          const oldUpdate = collection.access?.update
          const result = oldUpdate ? await oldUpdate(args) : true
          const env = await getEnv(args.req.payload)
          if (env === 'development') {
            const { allowed, identifiedDocuments } = await checkDevelopmentUploadWrite(
              args,
              collection.slug,
            )
            if (!allowed) {
              if (identifiedDocuments && isMutationRequest(args.req)) {
                throw new APIError(
                  'Cannot update upload collection documents that were not created during development, as it will potentially modify the file(s) in cloud storage.',
                  403,
                  null,
                  true,
                )
              }
              return false
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
 *
 * A client upload's prefix is set by payload from its signed receipt — the
 * location the bytes were already written to, which the signed-URL endpoint placed
 * in the development area — so it is left as is.
 */
const getDevelopmentBeforeOperationHook = (
  collectionSlug: string,
  getEnv: GetEnv,
  developmentFileStorage: DevelopmentFileStorageArgs,
): CollectionBeforeOperationHook => {
  const developmentPrefixPlacement = getDevelopmentPrefixPlacement(
    developmentFileStorage,
    collectionSlug,
  )
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
    if (developmentFileStorage.mode !== 'cloud-storage' || !developmentFileStorage.prefix) {
      return args
    }
    const file = req.file as { clientUploadContext?: unknown } | undefined
    if (file?.clientUploadContext) {
      return args
    }
    // No prefix in the incoming data (the field's defaultValue only applies later,
    // during beforeValidate) starts from the collection prefix.
    const collectionPrefix = getCollectionPrefix(developmentFileStorage, collectionSlug)
    data.prefix = toDevelopmentPrefix(
      (typeof data.prefix === 'string' && data.prefix) || collectionPrefix,
      {
        collectionPrefix,
        developmentPrefix: developmentFileStorage.prefix,
        placement: developmentPrefixPlacement,
      },
    )
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
  afterChangeHook: CollectionAfterChangeHook
  afterDeleteHook: CollectionAfterDeleteHook
}

const hooks: Record<CollectionSlug, UploadHooks> = {}

/**
 * Prevents files from being uploaded or deleted in development by removing the
 * cloud-storage plugin's `afterChange` (upload) and `afterDelete` hooks.
 */
const toggleCollectionHooks = <T extends CollectionConfig | SanitizedCollectionConfig>(
  collection: T,
  enabled: boolean,
): T => {
  if (enabled) {
    if (hooks[collection.slug]) {
      collection.hooks = {
        ...(collection.hooks || {}),
        afterChange: [
          ...(collection.hooks?.afterChange || []),
          hooks[collection.slug].afterChangeHook,
        ],
        afterDelete: [
          ...(collection.hooks?.afterDelete || []),
          hooks[collection.slug].afterDeleteHook,
        ],
      }
      delete hooks[collection.slug]
    }
  } else {
    const afterChangeHooks = collection.hooks?.afterChange || []
    const afterDeleteHooks = collection.hooks?.afterDelete || []
    const afterChangeHook = afterChangeHooks.at(-1)
    const afterDeleteHook = afterDeleteHooks.at(-1)
    if (afterChangeHook && afterDeleteHook) {
      hooks[collection.slug] = {
        afterChangeHook,
        afterDeleteHook,
      }
      afterChangeHooks.pop()
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
 * Places client uploads in the development area. The admin sends the doc `prefix`
 * field value as `docPrefix` with the signed-URL request, and the storage plugin
 * resolves the upload key from it, contained beneath its collection prefix. That
 * field's default is the collection prefix the storage plugin read, so unless the
 * development prefix was applied before it read its options, a development upload
 * would land in the production area.
 *
 * Wrap the cloud-storage plugin's signed-URL endpoint(s) — located via the
 * serverHandlerPath that initClientUploads stores on the admin providers — and move
 * docPrefix into the development area at request time (see developmentPrefix.ts).
 * This covers default, user-defined and function-generated doc prefixes; the
 * signed receipt then carries the location through to the stored document.
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
          // An empty docPrefix falls back to the collection prefix.
          const collectionPrefix = getCollectionPrefix(developmentFileStorage, body.collectionSlug)
          body.docPrefix = toDevelopmentPrefix(
            (typeof body.docPrefix === 'string' && body.docPrefix) || collectionPrefix,
            {
              collectionPrefix,
              developmentPrefix: developmentFileStorage.prefix,
              placement: getDevelopmentPrefixPlacement(developmentFileStorage, body.collectionSlug),
            },
          )
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
) => {
  modifyUploadCollections(config.collections || [], env, developmentFileStorage)
  toggleUploadProviders(config, env, developmentFileStorage.mode)
}

export const modifyUploadCollections = (
  collections: (CollectionConfig | SanitizedCollectionConfig)[],
  env: Env,
  developmentFileStorage: DevelopmentFileStorageArgs,
) => {
  const production = env === 'production'
  collections
    .filter((c) => c.upload)
    .forEach((collection) => {
      toggleCollectionHooks(
        collection,
        production || developmentFileStorage.mode === 'cloud-storage',
      )
      toggleLocalStorage(collection, !production && developmentFileStorage.mode === 'file-system')
    })
}

/**
 * Query-string keys that carry document ids. Payload's REST layer takes `id`
 * directly, and expresses selections as `where[id][…]` — optionally nested in an
 * `and` / `or` group, which is what the admin's bulk delete sends
 * (`where[and][0][id][in][0]`). Matching loosely on `key.includes('id')` would
 * also collect any user field whose *name* merely contains "id"
 * (`where[videoId][equals]=abc`) and feed those values into an `id in (…)`
 * lookup, which a numeric-id database rejects outright.
 */
const idQueryParamKey = /^id$|^where(?:\[[^[\]]+\])*\[id\](?:\[|$)/

/** The documents a write targets, from the route param and the query string. */
const getTargetedDocumentIds = (req: PayloadRequest, id?: string): string[] => {
  const documentIds = Array.from(req.searchParams.entries())
    .filter(([key, _]) => idQueryParamKey.test(key))
    .map(([_, value]) => value)

  if (id) {
    documentIds.push(id)
  }

  return documentIds
}

const anyDocumentNotCreatedDuringDevelopment = async (
  req: PayloadRequest,
  collectionSlug: CollectionSlug,
  documentIds: string[],
) => {
  const documents = await req.payload.find({
    collection: collectionSlug,
    // Trashed documents are excluded by default, and permanently deleting from
    // the trash view is precisely a write against one — without this the guard
    // would wave through every already-trashed production document.
    trash: true,
    where: {
      id: { in: documentIds },
    },
  })
  return documents.docs.some(
    (doc) =>
      typeof doc.createdDuringDevelopment !== 'boolean' || doc.createdDuringDevelopment === false,
  )
}

/**
 * Whether the request is an actual write, as opposed to a permission probe.
 *
 * Payload evaluates the same access function in two situations that look
 * identical from `id` and `data`: as the gate of a real write (a REST `PATCH` or
 * `DELETE`, the admin's saves and bulk actions) and as a probe —
 * `docAccessOperation` asking "may this user update/delete this document?" to
 * build the permissions object behind the admin's document view and the REST
 * `/access/:id` endpoint. A probe even carries the full stored document as
 * `data`. Throwing during a probe is not a refusal Payload can act on:
 * `getDocumentPermissions` catches it, continues with no permissions at all, and
 * the admin renders "Nothing found" for a document that should simply open
 * read-only. So the descriptive 403 is reserved for requests that actually
 * mutate; a probe gets a plain `false`.
 *
 * REST requests carry their HTTP method. Requests built by `createLocalReq` (the
 * admin's page renders, the local API) carry none, and neither is a REST write.
 * GraphQL always arrives as `POST`, so a GraphQL access *query* receives the 403
 * message rather than `false` — the price of keeping the message on mutations.
 */
const isMutationRequest = (req: PayloadRequest): boolean =>
  ['DELETE', 'PATCH', 'POST', 'PUT'].includes((req.method ?? '').toUpperCase())

/**
 * Whether a development-mode write may touch the documents it targets, and
 * whether it identified any documents at all.
 *
 * The *stored* `createdDuringDevelopment` flag is the authoritative signal, so
 * resolve the targeted documents whenever the request names any. Incoming `data`
 * is consulted only when it does not, because payload sends partial bodies for
 * some writes — with `trash` enabled the admin's delete button is a
 * `PATCH { deletedAt }` and nothing else. A flag missing from `data` therefore
 * means "not stated", never "not created during development"; reading it from
 * `data` alone denied every trash delete with a bare 403.
 */
const checkDevelopmentUploadWrite = async (
  args: { data?: Record<string, unknown>; id?: number | string; req: PayloadRequest },
  collectionSlug: CollectionSlug,
): Promise<{ allowed: boolean; identifiedDocuments: boolean }> => {
  const documentIds = getTargetedDocumentIds(args.req, args.id?.toString())

  if (documentIds.length === 0) {
    // An id-less bulk write: nothing to resolve, so fall back to what the write
    // itself declares.
    return {
      allowed: args.data ? !!args.data.createdDuringDevelopment : true,
      identifiedDocuments: false,
    }
  }

  return {
    allowed: !(await anyDocumentNotCreatedDuringDevelopment(args.req, collectionSlug, documentIds)),
    identifiedDocuments: true,
  }
}

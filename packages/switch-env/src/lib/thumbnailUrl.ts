import type {
  CollectionConfig,
  Config,
  FieldHook,
  GetAdminThumbnail,
  SanitizedCollectionConfig,
  SanitizedConfig,
  UploadConfig,
} from 'payload'

import fsPromises from 'fs/promises'
import nodePath from 'path'
import { formatAdminURL } from 'payload/shared'

import { getDevelopmentStorageMode } from './developmentFileStorage.js'

type AdminThumbnail = UploadConfig['adminThumbnail']

type DocWithSizes = {
  _objectKey?: null | string
  filename?: string
  prefix?: null | string
  sizes?: Record<string, { filename?: string; width?: number } | undefined>
}

export const getModifiedAdminThumbnail = (
  originalAdminThumbnail: AdminThumbnail,
  config: Config | SanitizedConfig,
  collection: CollectionConfig | SanitizedCollectionConfig,
): AdminThumbnail => {
  const getAdminThumbnail: GetAdminThumbnail = (args) => {
    const doc = args.doc
    const createdDuringDevelopment = doc.createdDuringDevelopment === true
    const developmentStorageMode = getDevelopmentStorageMode(doc)
    if (
      typeof doc.createdDuringDevelopment !== 'boolean' ||
      (createdDuringDevelopment && developmentStorageMode !== 'cloud-storage')
    ) {
      return null
    } else if (originalAdminThumbnail) {
      return getThumbnailResult(config, collection, originalAdminThumbnail, args)
    } else {
      return null
    }
  }
  return getAdminThumbnail
}

const getThumbnailResult = (
  config: Config | SanitizedConfig,
  collection: CollectionConfig | SanitizedCollectionConfig,
  adminThumbnail: AdminThumbnail,
  args: Parameters<GetAdminThumbnail>[0],
) => {
  if (typeof adminThumbnail === 'function') {
    return adminThumbnail(args)
  }

  if (typeof adminThumbnail === 'string') {
    const url = generateURL({
      collectionSlug: collection.slug,
      config,
      filename: (args.doc as DocWithSizes).sizes?.[adminThumbnail]?.filename,
    })
    if (typeof url === 'undefined') {
      return null
    } else {
      return url
    }
  }
  return null
}

type GenerateURLArgs = {
  collectionSlug: string
  config: Config | SanitizedConfig
  filename?: string
}

const generateURL = ({ collectionSlug, config, filename }: GenerateURLArgs) => {
  if (filename) {
    // formatAdminURL prepends a Next.js `basePath` (process.env.NEXT_BASE_PATH) when set,
    // so admin thumbnails resolve correctly under a basePath instead of 404ing.
    return formatAdminURL({
      apiRoute: config.routes?.api || '',
      path: `/${collectionSlug}/file/${encodeURIComponent(filename)}`,
      serverURL: config.serverURL || '',
    })
  }
  return undefined
}

export interface AdminThumbnailArgs {
  basePath: string
  imageSize?: string
}

/**
 * Builds a direct storage URL: `${basePath}/${prefix}/${_objectKey}/${filename}`.
 *
 * Client uploads are stored in a per-upload folder named by the doc's `_objectKey`
 * (image sizes included), which the cloud-storage plugin joins onto the prefix for
 * every key and URL it builds; either part may be empty.
 */
export const adminThumbnail =
  ({ basePath, imageSize }: AdminThumbnailArgs): GetAdminThumbnail =>
  ({ doc }) => {
    const typedDoc = doc as DocWithSizes
    let filename = typedDoc.filename ?? ''
    if (imageSize) {
      const sizeFilename = typedDoc.sizes?.[imageSize]?.filename
      if (sizeFilename) {
        filename = sizeFilename
      }
    }
    const folder = [typedDoc.prefix, typedDoc._objectKey]
      .filter((segment): segment is string => typeof segment === 'string' && segment !== '')
      .map((segment) => `${segment}/`)
      .join('')
    return `${basePath}/${folder}${filename}`
  }

const localFileExists = async (
  collection: CollectionConfig | null | SanitizedCollectionConfig | undefined,
  filename: string | undefined,
): Promise<boolean> => {
  if (!collection || !filename) {
    return false
  }

  const fileDir =
    typeof collection.upload === 'object' && collection.upload.staticDir
      ? collection.upload.staticDir
      : collection.slug
  const filePath = nodePath.resolve(`${fileDir}/${filename}`)

  try {
    await fsPromises.stat(filePath)
    return true
  } catch {
    return false
  }
}

export const getModifiedAfterReadHook = (afterReadHook: FieldHook): FieldHook => {
  return async (args) => {
    const { collection, data, path } = args
    if (!data?.createdDuringDevelopment) {
      return afterReadHook(args)
    }

    let size: string | undefined
    if (path[0] === 'sizes' && typeof path[1] === 'string') {
      size = path[1]
    } else if (path[0] === 'thumbnailURL' && collection) {
      const adminThumbnail = collection.upload.adminThumbnail
      if (typeof adminThumbnail === 'string') {
        size = adminThumbnail
      } else {
        // Resort to smallest size
        const sizesObj = (data?.sizes ?? {}) as Record<string, { width?: number } | undefined>
        size = Object.entries(sizesObj)
          .map(([size, value]) => ({
            size,
            width: value?.width ?? 0,
          }))
          .sort((a, b) => a.width - b.width)[0].size
      }
    }
    const filename = size ? data?.sizes?.[size]?.filename : data?.filename

    const developmentStorageMode = getDevelopmentStorageMode(data)
    const shouldGenerateLocalUrl =
      developmentStorageMode === 'file-system' ||
      (!developmentStorageMode && (await localFileExists(collection, filename)))

    if (!shouldGenerateLocalUrl) {
      return afterReadHook(args)
    }

    const url = generateURL({
      collectionSlug: args.collection?.slug || '',
      config: args.req.payload.config,
      filename,
    })
    return url
  }
}

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

import { getDevelopmentStorageMode } from './developmentFileStorage.js'

type AdminThumbnail = UploadConfig['adminThumbnail']

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
      filename: (args.doc as any).sizes?.[adminThumbnail].filename as string,
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
    return `${config.serverURL || ''}${
      config.routes?.api || ''
    }/${collectionSlug}/file/${encodeURIComponent(filename)}`
  }
  return undefined
}

export interface AdminThumbnailArgs {
  basePath: string
  imageSize?: string
}

export const adminThumbnail =
  ({ basePath, imageSize }: AdminThumbnailArgs): GetAdminThumbnail =>
  ({ doc }) => {
    let filename = doc.filename as string
    if (imageSize) {
      const sizeFilename = (doc as any).sizes?.[imageSize].filename as string
      if (sizeFilename) {
        filename = sizeFilename
      }
    }
    return `${basePath}/${doc.prefix ? `${doc.prefix}/` : ''}${filename}`
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
        size = Object.entries(data?.sizes || {})
          .map(([size, value]) => ({
            size,
            value,
          }))
          .sort((a, b) => (a as any).value.width - (b as any).value.width)[0].size
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

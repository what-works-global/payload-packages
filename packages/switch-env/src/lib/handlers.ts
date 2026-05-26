import type { PayloadRequest, TypeWithID } from 'payload'

import fsPromises from 'fs/promises'
import path from 'path'

import type { GetEnv } from '../types.js'

type Handler = (
  req: PayloadRequest,
  args: {
    doc: TypeWithID
    params: { clientUploadContext?: unknown; collection: string; filename: string }
  },
) => Promise<Response> | Promise<void> | Response | void

export const getModifiedHandler = (oldHandler: Handler, getEnv: GetEnv) => {
  const newHandler: Handler = async (req, args) => {
    const env = await getEnv(req.payload)
    if (env === 'development') {
      const collection = req.payload.collections[args.params.collection]
      const fileDir = collection.config.upload?.staticDir || collection.config.slug
      const filePath = path.resolve(`${fileDir}/${args.params.filename}`)
      try {
        await fsPromises.stat(filePath)
        return
      } catch {
        req.payload.logger.warn(`File not found: ${filePath}`)
      }
    }
    const result = await oldHandler(req, args)
    if (result instanceof Promise) {
      return result
    }
    return result
  }
  return newHandler
}

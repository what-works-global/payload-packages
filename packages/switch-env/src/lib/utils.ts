import type { PayloadRequest } from 'payload'

export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

export const getServerUrl = (req: PayloadRequest) => {
  const host = req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const scheme = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const serverUrl = `${scheme}://${host}`
  return serverUrl
}

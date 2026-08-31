/**
 * `doc.url` is a full https S3 url in prod, or a relative path like
 * `/api/media/file/foo.mp4` in local dev (served by the app itself).
 * Prefixing `serverURL` only when needed makes both cases fetchable
 * uniformly — no storage-type detection required.
 */
export function resolveSourceUrl(rawUrl: string, serverURL?: string): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl
  }
  const base = serverURL || process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'
  return new URL(rawUrl, base).toString()
}

/**
 * Cache adapters. This module must stay importable from both the Payload
 * server and Next.js middleware/proxy bundles (including edge), so Node
 * built-ins are only imported lazily, inside the adapter methods that need
 * them. The Vercel Runtime Cache adapter lives in its own
 * `@whatworks/payload-redirects/vercel` entry: `@vercel/functions` is an
 * optional peer dependency, and bundlers resolve even dynamic `import()`s at
 * build time — referencing it here would force it on every consumer.
 */
import type { CachedRedirect, RedirectsCache } from '../core/shared.js'

import { isCachedRedirect } from '../core/shared.js'

export type { CachedRedirect, RedirectsCache } from '../core/shared.js'

/**
 * In-process cache. Only useful when the writer (Payload hooks) and the
 * reader (middleware) share one long-lived process — tests, and single
 * self-hosted servers where the middleware runs in the Node runtime. On
 * serverless (and in `next dev`, where the middleware sandbox and the server
 * are separate module graphs) writes are invisible to the reader — use
 * `fileCache`/`vercelRuntimeCache` there.
 */
export const memoryCache = (): RedirectsCache => {
  let entries: CachedRedirect[] | null = null
  return {
    get: () => Promise.resolve(entries),
    set: (redirects) => {
      entries = redirects
      return Promise.resolve()
    },
  }
}

export type FileCacheOptions = {
  /**
   * Path of the JSON cache file, resolved against the working directory.
   * @default '.next/cache/payload-redirects.json'
   */
  path?: string
}

/**
 * JSON-file cache. The default for development: it bridges the separate
 * module graphs `next dev` runs the middleware and the server in, and
 * survives restarts. Requires a Node runtime on the reading side (Next 16
 * `proxy.ts`, or `middleware.ts` with the `nodejs` runtime).
 */
export const fileCache = (options: FileCacheOptions = {}): RedirectsCache => {
  const relativePath = options.path ?? '.next/cache/payload-redirects.json'

  const resolveTarget = async () => {
    const path = await import('node:path')
    return path.resolve(relativePath)
  }

  return {
    get: async () => {
      const { readFile } = await import('node:fs/promises')
      try {
        const parsed = JSON.parse(await readFile(await resolveTarget(), 'utf8')) as {
          redirects?: unknown
        }
        if (!Array.isArray(parsed?.redirects)) {
          return null
        }
        return parsed.redirects.filter(isCachedRedirect)
      } catch {
        // Missing or corrupt file — a miss; the next set() rewrites it whole.
        return null
      }
    },
    set: async (redirects) => {
      const { mkdir, rename, writeFile } = await import('node:fs/promises')
      const path = await import('node:path')
      const target = await resolveTarget()
      await mkdir(path.dirname(target), { recursive: true })

      // Write-then-rename so concurrent readers never see a partial file.
      const temporary = `${target}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify({ redirects }, null, 2))
      await rename(temporary, target)
    },
  }
}

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
 * Coerces a value read from a key-value store into a validated redirect list.
 * Tolerates both a JSON string (ioredis, node-redis, Cloudflare KV) and an
 * already-parsed array (`@upstash/redis` auto-deserializes). Malformed or
 * missing values become `null`; individual bad entries are filtered out.
 */
const parseCachedRedirects = (value: unknown): CachedRedirect[] | null => {
  let data: unknown = value
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!Array.isArray(data)) {
    return null
  }
  return data.filter(isCachedRedirect)
}

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

/**
 * A cache branch for {@link envCache}: either a ready `RedirectsCache` instance
 * or a thunk that builds one. Passing a thunk keeps the branch lazy — it is only
 * invoked if it's the selected branch, so an unused branch's construction cost
 * (opening a Redis connection, reading `process.env`, …) is never paid.
 */
export type EnvCacheBranch = (() => RedirectsCache) | RedirectsCache

export type EnvCacheOptions = {
  /**
   * Cache used when `select()` returns `'development'` — the explicit stand-in
   * for the runtime/edge cache while `next dev` runs, where those backends don't
   * exist. Given as an instance or a thunk (only built if selected).
   * @default fileCache()
   */
  development?: EnvCacheBranch
  /**
   * Cache used when `select()` returns `'production'`. Given as an instance or a
   * thunk (only built if selected), so e.g.
   * `production: () => redisCache({ client: makeRedis() })` never opens a
   * connection during local development.
   */
  production: EnvCacheBranch
  /**
   * Chooses the branch, evaluated once at construction.
   * @default () => (process.env.NODE_ENV === 'development' ? 'development' : 'production')
   */
  select?: () => 'development' | 'production'
}

const resolveEnvCacheBranch = (branch: EnvCacheBranch): RedirectsCache =>
  typeof branch === 'function' ? branch() : branch

/**
 * Composes two caches and picks one **once, at construction**, based on the
 * environment — the explicit, call-site replacement for the old per-adapter
 * `development` option. Only the chosen branch is resolved: pass the other as a
 * thunk and its cache is never constructed (no stray Redis connection or Vercel
 * client in dev). When the development branch engages it logs a one-line notice
 * so the switch is discoverable; production is silent.
 *
 * `select` defaults to `NODE_ENV`, but override it for cases where that lies —
 * e.g. Vercel preview deployments run with `NODE_ENV === 'production'` yet you
 * may want the file cache: `select: () => process.env.VERCEL_ENV === 'production'
 * ? 'production' : 'development'`.
 */
export const envCache = (options: EnvCacheOptions): RedirectsCache => {
  const {
    development,
    production,
    select = () => (process.env.NODE_ENV === 'development' ? 'development' : 'production'),
  } = options

  if (select() === 'development') {
    // eslint-disable-next-line no-console -- surface the dev-cache switch so it's discoverable
    console.info(
      '[payload-redirects] development environment detected — using the development cache (default: file cache)',
    )
    return resolveEnvCacheBranch(development ?? fileCache())
  }

  return resolveEnvCacheBranch(production)
}

/** Minimal structural view of a Redis client — the subset the adapter uses. */
export type RedisCacheClient = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: string) => Promise<unknown>
}

export type RedisCacheOptions = {
  /**
   * Any client exposing `get`/`set` — ioredis, node-redis v4, or
   * `@upstash/redis` all satisfy this shape.
   */
  client: RedisCacheClient
  /**
   * Key the redirect list is stored under.
   * @default 'payload-redirects'
   */
  key?: string
}

/**
 * Redis-backed cache. The list is stored as a JSON string; on read it accepts
 * either a JSON string (ioredis, node-redis) or an already-parsed array
 * (`@upstash/redis` auto-deserializes). A missing key or malformed value is a
 * miss. No dependency is added — pass whichever client you already use.
 */
export const redisCache = (options: RedisCacheOptions): RedirectsCache => {
  const { client, key = 'payload-redirects' } = options
  return {
    get: async () => {
      const value = await client.get(key)
      if (value === null || value === undefined) {
        return null
      }
      return parseCachedRedirects(value)
    },
    set: async (redirects) => {
      await client.set(key, JSON.stringify(redirects))
    },
  }
}

/** Minimal structural view of a Cloudflare KV namespace binding. */
export type CloudflareKVNamespace = {
  get: (key: string, type: 'text') => Promise<null | string>
  put: (key: string, value: string) => Promise<unknown>
}

export type CloudflareKVCacheOptions = {
  /**
   * Key the redirect list is stored under.
   * @default 'payload-redirects'
   */
  key?: string
  /** The KV namespace binding (e.g. `env.REDIRECTS`). */
  namespace: CloudflareKVNamespace
}

/**
 * Cloudflare Workers KV cache. Reads the value as text and parses it as JSON; a
 * missing key or malformed value is a miss. No dependency is added — pass the
 * KV binding from your Worker/Pages environment.
 */
export const cloudflareKVCache = (options: CloudflareKVCacheOptions): RedirectsCache => {
  const { key = 'payload-redirects', namespace } = options
  return {
    get: async () => {
      const value = await namespace.get(key, 'text')
      if (value === null || value === undefined) {
        return null
      }
      return parseCachedRedirects(value)
    },
    set: async (redirects) => {
      await namespace.put(key, JSON.stringify(redirects))
    },
  }
}

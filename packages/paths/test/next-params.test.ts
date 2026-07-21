/**
 * The Next.js wrapper's configurable route param name (`paramName`, default
 * `slug`). Covers both sides that must agree: the key `createGenerateStaticParams`
 * EMITS and the key `createPathResolver` READS. `next/*` and React `cache` are
 * mocked to identity/no-request stubs so the wrapper runs outside a Next request.
 */
import type { Payload } from 'payload'
import type * as ReactModule from 'react'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Run the wrapper outside a Next request: caches are identity, draft mode is
// off, and notFound()/redirect() throw recognizable sentinels.
vi.mock('next/cache.js', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('next/headers.js', () => ({
  draftMode: () => Promise.resolve({ isEnabled: false }),
}))
vi.mock('next/navigation.js', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return { ...actual, cache: (fn: unknown) => fn }
})

const { noopPathsCache } = await import('../src/exports/cache.js')
const { createGenerateStaticParams, createPathResolver } = await import('../src/exports/next.js')
const { createParentField, definePathsConfig, pathsPlugin } = await import('../src/index.js')

const pathsConfig = definePathsConfig({
  collections: { pages: { strategy: 'parent' } },
})

let payload: Payload
let destroy: () => Promise<void>
const getPayloadInstance = () => Promise.resolve(payload)

beforeAll(async () => {
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-next-params-'))
  const dbFile = path.join(tmpDir, 'test.db')
  const config = await buildConfig({
    collections: [
      {
        slug: 'pages',
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'slug', type: 'text', required: true },
          createParentField('pages'),
        ],
        versions: { drafts: true },
      },
    ],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
    plugins: [pathsPlugin({ ...pathsConfig, backfill: 'off' })],
    secret: 'next-params-secret',
    telemetry: false,
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config, key: tmpDir })

  const hello = await payload.create({
    collection: 'pages',
    data: { slug: 'hello', _status: 'published', title: 'Hello' },
    draft: false,
  })
  await payload.create({
    collection: 'pages',
    data: { slug: 'world', _status: 'published', parent: hello.id, title: 'World' },
    draft: false,
  })

  destroy = async () => {
    if (typeof payload?.db?.destroy === 'function') {
      await payload.db.destroy()
    }
    fs.rmSync(tmpDir, { force: true, recursive: true })
  }
})

afterAll(async () => {
  await destroy?.()
})

describe('createGenerateStaticParams paramName', () => {
  it('emits the `slug` key by default', async () => {
    const generate = createGenerateStaticParams({
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
    })
    const params = await generate()
    expect(params).toContainEqual({ slug: ['hello'] })
    expect(params).toContainEqual({ slug: ['hello', 'world'] })
  })

  it('emits a custom param key when `paramName` is set', async () => {
    const generate = createGenerateStaticParams({
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
      paramName: 'path',
    })
    const params = await generate()
    expect(params).toContainEqual({ path: ['hello'] })
    expect(params).toContainEqual({ path: ['hello', 'world'] })
    expect(params.some((entry) => 'slug' in entry)).toBe(false)
  })

  it('narrows the prerendered set with a `where` override', async () => {
    const generate = createGenerateStaticParams({
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
      where: { slug: { equals: 'world' } },
    })
    const params = await generate()
    expect(params).toContainEqual({ slug: ['hello', 'world'] })
    expect(params).not.toContainEqual({ slug: ['hello'] })
  })
})

describe('createPathResolver paramName', () => {
  it('reads segments from `params.slug` by default', async () => {
    const resolvePage = createPathResolver({
      cache: noopPathsCache(),
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
    })
    const resolved = await resolvePage({ params: Promise.resolve({ slug: ['hello'] }) })
    expect(resolved.path).toBe('/hello')
    expect(resolved.url).toBe('/hello')
  })

  it('reads segments from a custom param key when `paramName` is set', async () => {
    const resolvePage = createPathResolver({
      cache: noopPathsCache(),
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
      paramName: 'path',
    })
    const resolved = await resolvePage({ params: Promise.resolve({ path: ['hello', 'world'] }) })
    expect(resolved.path).toBe('/hello/world')

    // The wrong key resolves to the (empty) root and 404s — proving the key,
    // not luck, is what matches.
    await expect(resolvePage({ params: Promise.resolve({ slug: ['hello'] }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})

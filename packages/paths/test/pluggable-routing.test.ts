/**
 * The pluggable routing surface of the framework-agnostic core:
 * - `pagination` on `createPathsResolver` (rename the segment, drop the page-1
 *   redirect, or turn pagination off), and
 * - `createResolverChain` — multi-source resolution across collections, by
 *   segments (array order) and by pathname (prefix specificity).
 *
 * Exercised end-to-end against a real (sqlite) Payload so the DB lookups, prefix
 * stripping, and draft filtering are all in play.
 */
import type { Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { noopPathsCache } from '../src/exports/cache.js'
import {
  createPathsResolver,
  createResolverChain,
  pagePathPagination,
} from '../src/exports/resolver.js'
import { createParentField, definePathsConfig, pathsPlugin } from '../src/index.js'

const pathsConfig = definePathsConfig({
  collections: {
    guides: { strategy: 'flat' },
    pages: { strategy: 'parent' },
    posts: { prefix: '/blog', strategy: 'flat' },
  },
})

let payload: Payload
let destroy: () => Promise<void>
const getPayloadInstance = () => Promise.resolve(payload)

const flatFields = [
  { name: 'title', type: 'text' as const, required: true },
  { name: 'slug', type: 'text' as const, required: true },
]

beforeAll(async () => {
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-routing-'))
  const dbFile = path.join(tmpDir, 'test.db')
  const config = await buildConfig({
    collections: [
      {
        slug: 'pages',
        fields: [...flatFields, createParentField('pages')],
        versions: { drafts: true },
      },
      { slug: 'guides', fields: flatFields, versions: { drafts: true } },
      { slug: 'posts', fields: flatFields, versions: { drafts: true } },
    ],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
    plugins: [pathsPlugin({ ...pathsConfig, backfill: 'off' })],
    secret: 'routing-secret',
    telemetry: false,
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config, key: tmpDir })

  const publish = { _status: 'published' as const }
  // pages (parent strategy): a page tree that includes /blog and /blog/hello.
  const blog = await payload.create({
    collection: 'pages',
    data: { ...publish, slug: 'blog', title: 'Blog landing' },
    draft: false,
  })
  await payload.create({
    collection: 'pages',
    data: { ...publish, slug: 'hello', parent: blog.id, title: 'A page at /blog/hello' },
    draft: false,
  })
  await payload.create({
    collection: 'pages',
    data: { ...publish, slug: 'shared', title: 'Page shared' },
    draft: false,
  })
  // guides (flat, root): /faq plus a /shared that collides with pages.
  await payload.create({
    collection: 'guides',
    data: { ...publish, slug: 'faq', title: 'FAQ' },
    draft: false,
  })
  await payload.create({
    collection: 'guides',
    data: { ...publish, slug: 'shared', title: 'Guide shared' },
    draft: false,
  })
  // posts (flat, prefix /blog): /blog/hello (collides with the page) and /blog/launch.
  await payload.create({
    collection: 'posts',
    data: { ...publish, slug: 'hello', title: 'A post at /blog/hello' },
    draft: false,
  })
  await payload.create({
    collection: 'posts',
    data: { ...publish, slug: 'launch', title: 'Launch post' },
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

const guidesResolver = (pagination?: false | ReturnType<typeof pagePathPagination>) =>
  createPathsResolver({
    cache: noopPathsCache(),
    collection: 'guides',
    config: pathsConfig,
    getPayload: getPayloadInstance,
    ...(pagination !== undefined ? { pagination } : {}),
  })

describe('pluggable pagination', () => {
  it('defaults to the /page/N scheme with a page-1 canonical redirect', async () => {
    const resolver = guidesResolver()

    const page2 = await resolver.resolve({ segments: ['faq', 'page', '2'] })
    expect(page2).toMatchObject({
      type: 'found',
      collection: 'guides',
      pageNumber: 2,
      path: '/faq',
    })

    const page1 = await resolver.resolve({ segments: ['faq', 'page', '1'] })
    expect(page1).toMatchObject({ type: 'redirect', redirectTo: '/faq' })
  })

  it('disables pagination with `pagination: false`', async () => {
    const resolver = guidesResolver(false)
    const page2 = await resolver.resolve({ segments: ['faq', 'page', '2'] })
    expect(page2.type).toBe('not-found')
    // A real document is still reachable at its exact path.
    expect((await resolver.resolve({ segments: ['faq'] })).type).toBe('found')
  })

  it('renames the page segment', async () => {
    const resolver = guidesResolver(pagePathPagination({ segment: 'p' }))

    const custom = await resolver.resolve({ segments: ['faq', 'p', '2'] })
    expect(custom).toMatchObject({ type: 'found', pageNumber: 2, path: '/faq' })

    const oldScheme = await resolver.resolve({ segments: ['faq', 'page', '2'] })
    expect(oldScheme.type).toBe('not-found')
  })

  it('serves page 1 in place when redirectFirstPage is false', async () => {
    const resolver = guidesResolver(pagePathPagination({ redirectFirstPage: false }))
    const page1 = await resolver.resolve({ segments: ['faq', 'page', '1'] })
    expect(page1).toMatchObject({ type: 'found', pageNumber: 1, path: '/faq' })
  })
})

describe('createResolverChain — multiple collections at one root', () => {
  const pages = () =>
    createPathsResolver({
      cache: noopPathsCache(),
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
    })
  const guides = () =>
    createPathsResolver({
      cache: noopPathsCache(),
      collection: 'guides',
      config: pathsConfig,
      getPayload: getPayloadInstance,
    })

  it('resolves each collection and reports which one matched', async () => {
    const chain = createResolverChain([pages(), guides()])

    expect(await chain.resolve({ segments: ['blog'] })).toMatchObject({
      type: 'found',
      collection: 'pages',
      path: '/blog',
    })
    expect(await chain.resolve({ segments: ['faq'] })).toMatchObject({
      type: 'found',
      collection: 'guides',
      path: '/faq',
    })
    expect((await chain.resolve({ segments: ['nope'] })).type).toBe('not-found')
  })

  it('breaks a same-path collision by chain order', async () => {
    expect(
      await createResolverChain([pages(), guides()]).resolve({ segments: ['shared'] }),
    ).toMatchObject({
      collection: 'pages',
    })
    expect(
      await createResolverChain([guides(), pages()]).resolve({ segments: ['shared'] }),
    ).toMatchObject({
      collection: 'guides',
    })
  })

  it('unions and dedupes listPaths, and reports the shared prefix', async () => {
    const chain = createResolverChain([pages(), guides()])
    const paths = await chain.listPaths()
    expect(paths).toEqual(expect.arrayContaining(['/blog', '/blog/hello', '/shared', '/faq']))
    expect(paths.filter((p) => p === '/shared')).toHaveLength(1)
    expect(chain.prefix).toBe('')
  })
})

describe('createResolverChain — pathname resolution by prefix specificity', () => {
  const pages = () =>
    createPathsResolver({
      cache: noopPathsCache(),
      collection: 'pages',
      config: pathsConfig,
      getPayload: getPayloadInstance,
    })
  const posts = () =>
    createPathsResolver({
      cache: noopPathsCache(),
      collection: 'posts',
      config: pathsConfig,
      getPayload: getPayloadInstance,
    })

  it('prefers the more specific prefix even when it is listed first', async () => {
    // Both a page (/blog/hello) and a post (/blog + /hello) live at /blog/hello.
    // The /blog-prefixed collection wins regardless of array order.
    const resolution = await createResolverChain([pages(), posts()]).resolve({
      pathname: '/blog/hello',
    })
    expect(resolution).toMatchObject({ type: 'found', collection: 'posts', path: '/hello' })

    // Proof the page could serve it — a pages-only chain does.
    expect(await createResolverChain([pages()]).resolve({ pathname: '/blog/hello' })).toMatchObject(
      { collection: 'pages', path: '/blog/hello' },
    )
  })

  it('falls back to the less specific prefix when the specific one declines', async () => {
    // posts has no document at '/', so /blog falls through to the root page.
    expect(
      await createResolverChain([pages(), posts()]).resolve({ pathname: '/blog' }),
    ).toMatchObject({
      collection: 'pages',
      path: '/blog',
    })
  })

  it('routes a prefixed-only URL to its collection', async () => {
    expect(
      await createResolverChain([pages(), posts()]).resolve({ pathname: '/blog/launch' }),
    ).toMatchObject({ collection: 'posts', path: '/launch' })
  })

  it('reports an empty prefix when children disagree', () => {
    expect(createResolverChain([pages(), posts()]).prefix).toBe('')
  })
})

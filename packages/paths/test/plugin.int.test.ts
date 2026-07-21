import type { Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { PathChangedEvent } from '../src/types.js'

import { memoryPathsCache } from '../src/exports/cache.js'
import { createPathsResolver } from '../src/exports/resolver.js'
import { backfillPaths, createParentField, definePathsConfig, pathsPlugin } from '../src/index.js'

type TestInstance = {
  destroy: () => Promise<void>
  payload: Payload
}

/**
 * Assert a Payload operation rejects with a ValidationError whose field-level
 * message matches. Payload surfaces a generic top-level message ("The
 * following field is invalid: slug") and keeps the friendly message in
 * `error.data.errors[].message` — which is what the admin renders next to the
 * field.
 */
const expectValidationMessage = async (
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> => {
  try {
    await promise
  } catch (error) {
    const data = (error as { data?: { errors?: { message?: string }[] } }).data
    const messages = (data?.errors ?? []).map((entry) => entry.message ?? '')
    const topLevel = (error as { message?: string }).message ?? ''
    expect(
      messages.some((message) => pattern.test(message)) || pattern.test(topLevel),
      `expected a validation message matching ${String(pattern)}, got: ${JSON.stringify(messages)} / "${topLevel}"`,
    ).toBe(true)
    return
  }
  throw new Error(`expected the operation to reject with ${String(pattern)}`)
}

const titleAndSlug = [
  { name: 'title', type: 'text' as const, required: true },
  { name: 'slug', type: 'text' as const, required: true },
]

/**
 * The shared config exercising every mode at once:
 * - `pages` — nested-docs plugin owns the cascade (auto-detected)
 * - `posts` — flat, with a `/blog` prefix
 * - `docs`  — parent strategy (own cascade), `/docs` prefix
 * - `tenant-pages` — parent strategy, scoped by tenant, NO drafts
 */
const pathsConfig = definePathsConfig({
  collections: {
    docs: { prefix: '/docs', strategy: 'parent' },
    pages: {},
    posts: { prefix: '/blog' },
    'tenant-pages': { scopeField: 'tenant', strategy: 'parent' },
  },
})

const events: PathChangedEvent[] = []
const cache = memoryPathsCache()

const buildMainInstance = async (): Promise<TestInstance> => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-test-'))
  const dbFile = path.join(tmpDir, 'test.db')

  const config = await buildConfig({
    collections: [
      { slug: 'pages', fields: [...titleAndSlug], versions: { drafts: true } },
      { slug: 'posts', fields: [...titleAndSlug], versions: { drafts: true } },
      {
        slug: 'docs',
        fields: [...titleAndSlug, createParentField('docs')],
        versions: { drafts: true },
      },
      { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
      {
        slug: 'tenant-pages',
        fields: [
          ...titleAndSlug,
          { name: 'tenant', type: 'relationship', relationTo: 'tenants' },
          createParentField('tenant-pages'),
        ],
      },
    ],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
    plugins: [
      nestedDocsPlugin({ collections: ['pages'] }),
      pathsPlugin({
        ...pathsConfig,
        backfill: 'off',
        cache,
        onPathChanged: (event) => {
          events.push(event)
        },
      }),
    ],
    secret: 'test-secret',
    telemetry: false,
    // getPayload auto-spawns a `payload generate:types` child process per
    // instance outside production; those workers outlive vitest as PPID=1
    // CPU-spinning zombies. Types are irrelevant to these tests.
    typescript: { autoGenerate: false },
  })

  const payload = await getPayload({ config, key: tmpDir })

  return {
    destroy: async () => {
      if (typeof payload?.db?.destroy === 'function') {
        await payload.db.destroy()
      }
      fs.rmSync(tmpDir, { force: true, recursive: true })
    },
    payload,
  }
}

/** Two instances over one sqlite file: A seeds + nulls paths, B boot-repairs. */
const buildBackfillPair = async (): Promise<{
  destroy: () => Promise<void>
  first: Payload
  second: () => Promise<Payload>
}> => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-backfill-'))
  const dbFile = path.join(tmpDir, 'test.db')

  const buildFor = async (backfill: 'fix' | 'off', key: string) => {
    const config = await buildConfig({
      collections: [{ slug: 'posts', fields: [...titleAndSlug], versions: { drafts: true } }],
      db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
      plugins: [pathsPlugin({ backfill, collections: { posts: { prefix: '/blog' } } })],
      secret: 'test-secret',
      telemetry: false,
      typescript: { autoGenerate: false },
    })
    return getPayload({ config, key: path.join(tmpDir, key) })
  }

  const first = await buildFor('off', 'first')
  let second: Payload | undefined

  return {
    destroy: async () => {
      for (const instance of [first, second]) {
        if (instance && typeof instance.db?.destroy === 'function') {
          await instance.db.destroy()
        }
      }
      fs.rmSync(tmpDir, { force: true, recursive: true })
    },
    first,
    second: async () => {
      second = await buildFor('fix', 'second')
      return second
    },
  }
}

let main: TestInstance
let backfillPair: Awaited<ReturnType<typeof buildBackfillPair>>

beforeAll(async () => {
  // db-sqlite's dev schema push caches the last-pushed schema at module scope
  // and skips the push when a later instance has an identical schema — leaving
  // that instance's fresh db without tables. Force every instance to push.
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  main = await buildMainInstance()
  backfillPair = await buildBackfillPair()
})

afterAll(async () => {
  await main?.destroy()
  await backfillPair?.destroy()
})

beforeEach(() => {
  events.length = 0
})

describe('flat strategy (posts, prefix /blog)', () => {
  it('computes prefix-free paths and prefixed virtual urls', async () => {
    const post = await main.payload.create({
      collection: 'posts',
      data: { slug: 'hello', _status: 'published', title: 'Hello' },
      draft: false,
    })
    expect(post.path).toBe('/hello')
    expect(post.url).toBe('/blog/hello')
  })

  it('maps the home slug to the collection root', async () => {
    const home = await main.payload.create({
      collection: 'posts',
      data: { slug: 'home', _status: 'published', title: 'Blog home' },
      draft: false,
    })
    expect(home.path).toBe('/')
    expect(home.url).toBe('/blog')
  })

  it('leaves slugless drafts unroutable instead of failing (autosave-safe)', async () => {
    const draft = await main.payload.create({
      collection: 'posts',
      data: { title: 'No slug yet' },
      draft: true,
    })
    expect(draft.path).toBeNull()
  })

  it('allows a colliding draft but rejects its publish', async () => {
    const draft = await main.payload.create({
      collection: 'posts',
      data: { slug: 'hello', title: 'Contender' },
      draft: true,
    })
    expect(draft.path).toBe('/hello')

    await expectValidationMessage(
      main.payload.update({
        id: draft.id,
        collection: 'posts',
        data: { _status: 'published' },
        draft: false,
      }),
      /already lives at \/blog\/hello/u,
    )
  })

  it('fires onPathChanged with previous and new paths and urls', async () => {
    const post = await main.payload.create({
      collection: 'posts',
      data: { slug: 'movable', _status: 'published', title: 'Movable' },
      draft: false,
    })
    events.length = 0

    await main.payload.update({
      id: post.id,
      collection: 'posts',
      data: { slug: 'moved' },
      draft: false,
    })

    const event = events.find((candidate) => candidate.previousPath === '/movable')
    expect(event).toBeDefined()
    expect(event?.newPath).toBe('/moved')
    expect(event?.previousUrl).toBe('/blog/movable')
    expect(event?.newUrl).toBe('/blog/moved')
  })
})

describe('nested-docs strategy (pages)', () => {
  let aboutId: number | string

  it('computes hierarchical paths', async () => {
    const home = await main.payload.create({
      collection: 'pages',
      data: { slug: 'home', _status: 'published', title: 'Home' },
      draft: false,
    })
    expect(home.path).toBe('/')
    expect(home.url).toBe('/')

    const about = await main.payload.create({
      collection: 'pages',
      data: { slug: 'about', _status: 'published', title: 'About' },
      draft: false,
    })
    aboutId = about.id
    expect(about.path).toBe('/about')

    const contact = await main.payload.create({
      collection: 'pages',
      data: { slug: 'contact', _status: 'published', parent: about.id, title: 'Contact' },
      draft: false,
    })
    expect(contact.path).toBe('/about/contact')

    const team = await main.payload.create({
      collection: 'pages',
      data: { slug: 'team', _status: 'published', parent: contact.id, title: 'Team' },
      draft: false,
    })
    expect(team.path).toBe('/about/contact/team')
  })

  it('allows the same slug at different levels — /contact next to /about/contact', async () => {
    const rootContact = await main.payload.create({
      collection: 'pages',
      data: { slug: 'contact', _status: 'published', title: 'Root contact' },
      draft: false,
    })
    expect(rootContact.path).toBe('/contact')
  })

  it('rejects publishing a sibling with the same slug', async () => {
    await expectValidationMessage(
      main.payload.create({
        collection: 'pages',
        data: {
          slug: 'contact',
          _status: 'published',
          parent: aboutId,
          title: 'Duplicate sibling',
        },
        draft: false,
      }),
      /already lives at \/about\/contact/u,
    )
  })

  it('cascades a parent rename through the whole subtree (via nested-docs)', async () => {
    await main.payload.update({
      id: aboutId,
      collection: 'pages',
      data: { slug: 'company' },
      draft: false,
    })

    const results = await main.payload.find({
      collection: 'pages',
      pagination: false,
      sort: 'path',
      where: { path: { like: '/company' } },
    })
    const paths = results.docs.map((doc) => doc.path)
    expect(paths).toContain('/company')
    expect(paths).toContain('/company/contact')
    expect(paths).toContain('/company/contact/team')

    const childEvent = events.find((event) => event.previousPath === '/about/contact')
    expect(childEvent?.newPath).toBe('/company/contact')
  })

  it('suffixes the slug on duplicate so the copy lands on its own path', async () => {
    // Payload copies the slug and published status verbatim; the injected
    // beforeDuplicate suffix keeps the copy off the original's path.
    const copy = await main.payload.duplicate({ id: aboutId, collection: 'pages' })
    expect(copy.slug).toBe('company-copy')
    expect(copy.path).toBe('/company-copy')
  })
})

describe('parent strategy (docs, prefix /docs, internal cascade)', () => {
  let rootId: number | string
  let childId: number | string
  let grandId: number | string

  it('computes hierarchical paths without the nested-docs plugin', async () => {
    const root = await main.payload.create({
      collection: 'docs',
      data: { slug: 'guides', _status: 'published', title: 'Guides' },
      draft: false,
    })
    rootId = root.id
    expect(root.path).toBe('/guides')
    expect(root.url).toBe('/docs/guides')

    const child = await main.payload.create({
      collection: 'docs',
      data: { slug: 'intro', _status: 'published', parent: root.id, title: 'Intro' },
      draft: false,
    })
    childId = child.id
    expect(child.path).toBe('/guides/intro')

    const grand = await main.payload.create({
      collection: 'docs',
      data: { slug: 'setup', _status: 'published', parent: child.id, title: 'Setup' },
      draft: false,
    })
    grandId = grand.id
    expect(grand.path).toBe('/guides/intro/setup')
  })

  it('cascades renames through its own re-save loop', async () => {
    await main.payload.update({
      id: rootId,
      collection: 'docs',
      data: { slug: 'handbook' },
      draft: false,
    })

    const child = await main.payload.findByID({ id: childId, collection: 'docs' })
    const grand = await main.payload.findByID({ id: grandId, collection: 'docs' })
    expect(child.path).toBe('/handbook/intro')
    expect(grand.path).toBe('/handbook/intro/setup')
  })

  it('rejects re-parenting a document under its own descendant', async () => {
    await expectValidationMessage(
      main.payload.update({
        id: rootId,
        collection: 'docs',
        data: { parent: grandId },
        draft: false,
      }),
      /cannot be nested under itself or one of its own descendants/u,
    )

    await expectValidationMessage(
      main.payload.update({
        id: rootId,
        collection: 'docs',
        data: { parent: rootId },
        draft: false,
      }),
      /cannot be its own parent/u,
    )
  })

  it('pre-flights descendant collisions before accepting a subtree move', async () => {
    // Simulate legacy/drifted data owning a path outside the hierarchy.
    const squatter = await main.payload.create({
      collection: 'docs',
      data: { slug: 'squatter', _status: 'published', title: 'Squatter' },
      draft: false,
    })
    await main.payload.db.updateOne({
      id: squatter.id,
      collection: 'docs',
      data: { path: '/manual/intro' },
      returning: false,
    })

    await expectValidationMessage(
      main.payload.update({
        id: rootId,
        collection: 'docs',
        data: { slug: 'manual' },
        draft: false,
      }),
      /clash with existing URLs: \/manual\/intro/u,
    )

    // Cleanup: give the squatter back a real path.
    await main.payload.db.updateOne({
      id: squatter.id,
      collection: 'docs',
      data: { path: '/squatter' },
      returning: false,
    })
  })
})

describe('multi-tenant scoping (tenant-pages)', () => {
  it('allows the same path in different scopes but not within one', async () => {
    const tenantA = await main.payload.create({ collection: 'tenants', data: { name: 'A' } })
    const tenantB = await main.payload.create({ collection: 'tenants', data: { name: 'B' } })

    const aAbout = await main.payload.create({
      collection: 'tenant-pages',
      data: { slug: 'about', tenant: tenantA.id, title: 'A about' },
    })
    expect(aAbout.path).toBe('/about')

    const bAbout = await main.payload.create({
      collection: 'tenant-pages',
      data: { slug: 'about', tenant: tenantB.id, title: 'B about' },
    })
    expect(bAbout.path).toBe('/about')

    await expectValidationMessage(
      main.payload.create({
        collection: 'tenant-pages',
        data: { slug: 'about', tenant: tenantA.id, title: 'A about again' },
      }),
      /already lives at \/about/u,
    )
  })
})

describe('resolver', () => {
  const buildResolver = () =>
    createPathsResolver({
      cache,
      collection: 'posts',
      config: pathsConfig,
      getPayload: () => Promise.resolve(main.payload),
    })

  it('resolves stored paths behind the prefix', async () => {
    const resolver = buildResolver()

    const bySegments = await resolver.resolve({ segments: ['hello'] })
    expect(bySegments.type).toBe('found')

    const byPathname = await resolver.resolve({ pathname: '/blog/hello' })
    expect(byPathname.type).toBe('found')

    const outsidePrefix = await resolver.resolve({ pathname: '/elsewhere/hello' })
    expect(outsidePrefix.type).toBe('not-found')

    const home = await resolver.resolve({ segments: [] })
    expect(home.type).toBe('found')
  })

  it('handles /page/N pagination against the base document', async () => {
    const resolver = buildResolver()

    const page2 = await resolver.resolve({ segments: ['hello', 'page', '2'] })
    expect(page2.type).toBe('found')
    if (page2.type === 'found') {
      expect(page2.pageNumber).toBe(2)
      expect(page2.path).toBe('/hello')
    }

    const page1 = await resolver.resolve({ segments: ['hello', 'page', '1'] })
    expect(page1).toMatchObject({ type: 'redirect', redirectTo: '/blog/hello' })

    const tooBig = await resolver.resolve({ segments: ['hello', 'page', '10000'] })
    expect(tooBig.type).toBe('not-found')

    const noBase = await resolver.resolve({ segments: ['nope', 'page', '2'] })
    expect(noBase.type).toBe('not-found')
  })

  it('serves cached lookups and picks up changes after hook invalidation', async () => {
    const resolver = buildResolver()

    const post = await main.payload.create({
      collection: 'posts',
      data: { slug: 'cached', _status: 'published', title: 'Version 1' },
      draft: false,
    })

    const first = await resolver.resolve({ segments: ['cached'] })
    expect(first.type === 'found' && (first.doc as { title?: string }).title).toBe('Version 1')

    await main.payload.update({
      id: post.id,
      collection: 'posts',
      data: { title: 'Version 2' },
      draft: false,
    })

    const second = await resolver.resolve({ segments: ['cached'] })
    expect(second.type === 'found' && (second.doc as { title?: string }).title).toBe('Version 2')
  })

  it('does not expose never-published drafts, but draft mode sees them', async () => {
    await main.payload.create({
      collection: 'posts',
      data: { slug: 'secret', title: 'Secret' },
      draft: true,
    })
    const resolver = buildResolver()

    const publicView = await resolver.resolve({ segments: ['secret'] })
    expect(publicView.type).toBe('not-found')

    const draftView = await resolver.resolve({ draft: true, segments: ['secret'] })
    expect(draftView.type).toBe('found')
  })

  it('lists published paths for static params', async () => {
    const resolver = buildResolver()
    const paths = await resolver.listPaths()
    expect(paths).toContain('/hello')
    expect(paths).toContain('/')
    expect(paths).not.toContain('/secret')
  })
})

describe('onInit backfill', () => {
  it('repairs null paths on boot and via the standalone helper', async () => {
    const { first, second } = backfillPair

    const created = await Promise.all(
      ['one', 'two', 'three'].map((slug) =>
        first.create({
          collection: 'posts',
          data: { slug, _status: 'published', title: slug },
          draft: false,
        }),
      ),
    )
    for (const doc of created) {
      await first.db.updateOne({
        id: doc.id,
        collection: 'posts',
        data: { path: null },
        returning: false,
      })
    }

    // Standalone check mode: reports, fixes nothing.
    const checkReport = await backfillPaths(first, { mode: 'check' })
    expect(checkReport.collections[0]).toMatchObject({ fixed: 0, missing: 3 })

    // Second instance boots over the same database with backfill: 'fix'.
    const repaired = await second()
    const results = await repaired.find({
      collection: 'posts',
      pagination: false,
      sort: 'path',
      where: { path: { exists: true } },
    })
    expect(results.docs.map((doc) => doc.path).sort()).toEqual(['/one', '/three', '/two'])
  })
})

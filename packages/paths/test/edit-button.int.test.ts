import type { Endpoint, Payload, PayloadRequest, TypedUser } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, createLocalReq, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { EditButtonContext } from '../src/core/editButtonContract.js'

import { createParentField, definePathsConfig, pathsPlugin } from '../src/index.js'

// db-sqlite's dev schema push caches the last-pushed schema at module scope
// and skips the push when a later instance has an identical schema — leaving
// that instance's fresh db without tables. Force every instance to push.
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

type TestInstance = {
  destroy: () => Promise<void>
  payload: Payload
}

const titleAndSlug = [
  { name: 'title', type: 'text' as const, required: true },
  { name: 'slug', type: 'text' as const, required: true },
]

const pathsConfig = definePathsConfig({
  collections: {
    docs: { strategy: 'parent' },
    posts: { prefix: '/blog' },
    'tenant-pages': { scopeField: 'tenant', strategy: 'parent' },
  },
})

const buildInstance = async (
  editButton: NonNullable<Parameters<typeof pathsPlugin>[0]['editButton']>,
): Promise<TestInstance> => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-edit-button-'))
  const dbFile = path.join(tmpDir, 'test.db')

  const config = await buildConfig({
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'customers', auth: true, fields: [] },
      {
        slug: 'docs',
        admin: { useAsTitle: 'title' },
        fields: [...titleAndSlug, createParentField('docs')],
        labels: { plural: 'Docs', singular: 'Doc' },
        versions: { drafts: true },
      },
      {
        slug: 'posts',
        admin: { useAsTitle: 'title' },
        fields: [...titleAndSlug],
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
    plugins: [pathsPlugin({ ...pathsConfig, backfill: 'off', editButton })],
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

const findEndpoint = (payload: Payload, endpointPath = '/paths/edit-button'): Endpoint => {
  const endpoint = payload.config.endpoints.find(
    (candidate) => candidate.path === endpointPath && candidate.method === 'get',
  )
  if (!endpoint) {
    throw new Error(`edit-button endpoint not registered at ${endpointPath}`)
  }
  return endpoint
}

/** Build a PayloadRequest the way the REST layer would: auth already done
 * (`user` attached) and the query available via `searchParams`. */
const buildRequest = async (
  payload: Payload,
  params: Record<string, string>,
  user: null | TypedUser,
): Promise<PayloadRequest> => {
  const req = await createLocalReq(user ? { user } : {}, payload)
  Object.assign(req, { searchParams: new URLSearchParams(params) })
  return req
}

const asUser = (doc: { id: number | string }, collection: string): TypedUser =>
  ({ ...doc, collection }) as TypedUser

describe('edit-button endpoint', () => {
  let instance: TestInstance
  let payload: Payload
  let admin: TypedUser
  let customer: TypedUser

  const call = async (
    params: Record<string, string>,
    user: null | TypedUser,
  ): Promise<{ body: { error?: string } & EditButtonContext; status: number }> => {
    const endpoint = findEndpoint(payload)
    const response = await endpoint.handler(await buildRequest(payload, params, user))
    return {
      body: (await response.json()) as { error?: string } & EditButtonContext,
      status: response.status,
    }
  }

  beforeAll(async () => {
    instance = await buildInstance(true)
    payload = instance.payload

    admin = asUser(
      await payload.create({
        collection: 'users',
        data: { email: 'editor@example.com', password: 'secret123' },
      }),
      'users',
    )
    customer = asUser(
      await payload.create({
        collection: 'customers',
        data: { email: 'customer@example.com', password: 'secret123' },
      }),
      'customers',
    )
  })

  afterAll(async () => {
    await instance.destroy()
  })

  it('registers the admin hint provider on the admin config', () => {
    expect(payload.config.admin.components?.providers).toContain(
      '@whatworks/payload-paths/client#PathsEditorHintProvider',
    )
  })

  it('rejects anonymous requests with 401', async () => {
    const { status } = await call({ pathname: '/anything' }, null)
    expect(status).toBe(401)
  })

  it('rejects users from non-admin auth collections with 403', async () => {
    const { status } = await call({ pathname: '/anything' }, customer)
    expect(status).toBe(403)
  })

  it('rejects a missing or relative pathname with 400', async () => {
    expect((await call({}, admin)).status).toBe(400)
    expect((await call({ pathname: 'not-absolute' }, admin)).status).toBe(400)
  })

  it('resolves a published document with admin URLs and status', async () => {
    const parent = await payload.create({
      collection: 'docs',
      data: { slug: 'guides', _status: 'published', title: 'Guides' },
      draft: false,
    })
    const child = await payload.create({
      collection: 'docs',
      data: { slug: 'install', _status: 'published', parent: parent.id, title: 'Install' },
      draft: false,
    })

    const { body, status } = await call({ pathname: '/guides/install' }, admin)
    expect(status).toBe(200)
    expect(body.doc).toMatchObject({
      id: child.id,
      collection: 'docs',
      collectionLabel: 'Doc',
      editURL: `/admin/collections/docs/${child.id}`,
      path: '/guides/install',
      status: 'published',
      title: 'Install',
      url: '/guides/install',
      versionsURL: `/admin/collections/docs/${child.id}/versions`,
    })
    expect(body.doc?.apiURL).toBe(`/admin/collections/docs/${child.id}/api`)
    expect(body.doc?.previewURL).toBeNull()
    expect(body.doc?.updatedAt).toBeTruthy()
    expect(body.urls).toEqual({
      account: '/admin/account',
      admin: '/admin',
      logout: '/api/users/logout',
    })
    expect(body.user).toMatchObject({ collection: 'users', email: 'editor@example.com' })
  })

  it('returns the ancestor trail root-first with edit links', async () => {
    const root = await payload.create({
      collection: 'docs',
      data: { slug: 'api', _status: 'published', title: 'API' },
      draft: false,
    })
    const mid = await payload.create({
      collection: 'docs',
      data: { slug: 'rest', _status: 'published', parent: root.id, title: 'REST' },
      draft: false,
    })
    await payload.create({
      collection: 'docs',
      data: { slug: 'auth', _status: 'published', parent: mid.id, title: 'Auth' },
      draft: false,
    })

    const { body } = await call({ pathname: '/api/rest/auth' }, admin)
    expect(body.doc?.ancestors).toEqual([
      {
        id: root.id,
        editURL: `/admin/collections/docs/${root.id}`,
        title: 'API',
        url: '/api',
      },
      {
        id: mid.id,
        editURL: `/admin/collections/docs/${mid.id}`,
        title: 'REST',
        url: '/api/rest',
      },
    ])
  })

  it('resolves prefixed collections from the public pathname', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: { slug: 'hello', _status: 'published', title: 'Hello' },
      draft: false,
    })

    const { body } = await call({ pathname: '/blog/hello' }, admin)
    expect(body.doc).toMatchObject({ id: post.id, collection: 'posts', url: '/blog/hello' })
    // Flat collections never report ancestors.
    expect(body.doc?.ancestors).toEqual([])
  })

  it('resolves /page/N pagination suffixes to the base document', async () => {
    const { body } = await call({ pathname: '/blog/hello/page/2' }, admin)
    expect(body.doc).toMatchObject({ collection: 'posts', path: '/hello' })
  })

  it('reports "draft" for never-published documents, even without draft=1', async () => {
    const draftOnly = await payload.create({
      collection: 'posts',
      data: { slug: 'wip', _status: 'draft', title: 'WIP' },
      draft: true,
    })

    // The live-site lookup misses (unpublished), then falls back to drafts so
    // an editor staring at a 404 still reaches the doc that will live there.
    const { body } = await call({ pathname: '/blog/wip' }, admin)
    expect(body.doc).toMatchObject({ id: draftOnly.id, collection: 'posts', status: 'draft' })
  })

  it('reports "changed" for published documents with a newer draft', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: { slug: 'evolving', _status: 'published', title: 'Evolving' },
      draft: false,
    })
    await payload.update({
      id: post.id,
      collection: 'posts',
      data: { title: 'Evolving (draft edit)' },
      draft: true,
    })

    const { body } = await call({ pathname: '/blog/evolving' }, admin)
    expect(body.doc).toMatchObject({ id: post.id, status: 'changed' })

    // With draft=1 (preview mode) the same URL reflects the newest version.
    const draft = await call({ draft: '1', pathname: '/blog/evolving' }, admin)
    expect(draft.body.doc).toMatchObject({
      id: post.id,
      status: 'changed',
      title: 'Evolving (draft edit)',
    })
  })

  it('returns doc: null (with urls intact) for unresolvable pathnames', async () => {
    const { body, status } = await call({ pathname: '/no/such/page' }, admin)
    expect(status).toBe(200)
    expect(body.doc).toBeNull()
    expect(body.urls.admin).toBe('/admin')
  })

  it('disambiguates scoped collections via the scope parameter', async () => {
    const tenantA = await payload.create({ collection: 'tenants', data: { name: 'A' } })
    const tenantB = await payload.create({ collection: 'tenants', data: { name: 'B' } })
    const pageA = await payload.create({
      collection: 'tenant-pages',
      data: { slug: 'about', tenant: tenantA.id, title: 'About A' },
    })
    const pageB = await payload.create({
      collection: 'tenant-pages',
      data: { slug: 'about', tenant: tenantB.id, title: 'About B' },
    })

    const a = await call({ pathname: '/about', scope: String(tenantA.id) }, admin)
    const b = await call({ pathname: '/about', scope: String(tenantB.id) }, admin)
    expect(a.body.doc?.id).toBe(pageA.id)
    expect(b.body.doc?.id).toBe(pageB.id)
    // Collections without drafts report no status.
    expect(a.body.doc?.status).toBeNull()
  })
})

describe('edit-button endpoint options', () => {
  it('honours a custom access gate and endpoint path', async () => {
    const instance = await buildInstance({
      access: ({ req }) => Boolean(req.user && String(req.user.email).endsWith('@allowed.com')),
      adminHint: false,
      endpointPath: '/custom/edit-context',
    })
    try {
      const { payload } = instance
      const endpoint = findEndpoint(payload, '/custom/edit-context')

      expect(payload.config.admin.components?.providers ?? []).not.toContain(
        '@whatworks/payload-paths/client#PathsEditorHintProvider',
      )

      const allowed = asUser(
        await payload.create({
          collection: 'customers',
          data: { email: 'someone@allowed.com', password: 'secret123' },
        }),
        'customers',
      )
      const denied = asUser(
        await payload.create({
          collection: 'users',
          data: { email: 'someone@denied.com', password: 'secret123' },
        }),
        'users',
      )

      const ok = await endpoint.handler(
        await buildRequest(payload, { pathname: '/anything' }, allowed),
      )
      expect(ok.status).toBe(200)

      // The custom gate fully replaces the admin-collection default — an
      // admin-collection user failing the predicate is rejected.
      const rejected = await endpoint.handler(
        await buildRequest(payload, { pathname: '/anything' }, denied),
      )
      expect(rejected.status).toBe(403)
    } finally {
      await instance.destroy()
    }
  })

  it('does not register the endpoint when editButton is disabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-edit-button-off-'))
    const config = await buildConfig({
      collections: [{ slug: 'posts', fields: [...titleAndSlug] }],
      db: sqliteAdapter({ client: { url: `file:${path.join(tmpDir, 'test.db')}` }, push: true }),
      plugins: [pathsPlugin({ backfill: 'off', collections: { posts: true } })],
      secret: 'test-secret',
      telemetry: false,
      typescript: { autoGenerate: false },
    })
    const payload = await getPayload({ config, key: tmpDir })
    try {
      expect(
        payload.config.endpoints.find((endpoint) => endpoint.path === '/paths/edit-button'),
      ).toBeUndefined()
    } finally {
      if (typeof payload?.db?.destroy === 'function') {
        await payload.db.destroy()
      }
      fs.rmSync(tmpDir, { force: true, recursive: true })
    }
  })
})

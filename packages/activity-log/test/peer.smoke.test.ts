import type { CollectionConfig, Config, PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { createBatcher } from '../src/cells/getLoggedDocumentStatus.js'
import {
  activityLogPlugin,
  defaultEvents,
  defaultResolveDocumentLabel,
  defaultResolveUserLabel,
  getActivityLogCustomConfig,
  getChangedFields,
  logCollectionAfterChange,
  logCollectionAfterDelete,
  pluginKey,
  userCellComponentPath,
  userFieldComponentPath,
} from '../src/index.js'

const baseConfig = (): Partial<Config> => ({
  admin: { user: 'users' },
  collections: [
    { slug: 'users', auth: true, fields: [] },
    {
      slug: 'posts',
      fields: [{ name: 'title', type: 'text' }],
      versions: { drafts: true },
    },
    { slug: 'tags', fields: [] },
  ],
  globals: [{ slug: 'settings', fields: [], versions: true }],
})

const getCollection = (config: Config, slug: string): CollectionConfig => {
  const collection = config.collections?.find((c) => c.slug === slug)
  if (!collection) {
    throw new Error(`Collection ${slug} missing`)
  }
  return collection
}

type CreatedEntry = { collection: string; data: Record<string, unknown> }

/** Minimal req double capturing payload.create calls. */
const buildReq = (overrides: Record<string, unknown> = {}) => {
  const created: CreatedEntry[] = []
  const req = {
    payload: {
      config: { custom: {} },
      create: vi.fn((args: CreatedEntry) => {
        created.push(args)
        return Promise.resolve({ id: 'log-entry' })
      }),
      findVersions: vi.fn(() => Promise.resolve({ docs: [{ id: 'version-1' }] })),
      logger: { error: vi.fn() },
    },
    query: {},
    user: { id: 'user-1', collection: 'users', email: 'a@b.co' },
    ...overrides,
  } as unknown as PayloadRequest
  return { created, req }
}

describe('@whatworks/payload-activity-log peer smoke', () => {
  it('adds the log collection and hooks to every entity by default', async () => {
    const result = await activityLogPlugin()(baseConfig() as Config)

    for (const slug of ['users', 'posts', 'tags']) {
      const collection = getCollection(result, slug)
      expect(collection.hooks?.afterChange).toHaveLength(1)
      expect(collection.hooks?.afterDelete).toHaveLength(1)
    }

    // Auth events only on auth collections.
    expect(getCollection(result, 'users').hooks?.afterLogin).toHaveLength(1)
    expect(getCollection(result, 'users').hooks?.afterLogout).toHaveLength(1)
    expect(getCollection(result, 'posts').hooks?.afterLogin).toBeUndefined()

    expect(result.globals?.[0]?.hooks?.afterChange).toHaveLength(1)

    const log = getCollection(result, 'activity-log')
    expect(log.timestamps).toBe(true)
    expect(log.disableDuplicate).toBe(true)
    const userField = log.fields.find((f) => 'name' in f && f.name === 'user')
    expect(userField).toMatchObject({
      admin: { components: { Cell: userCellComponentPath, Field: userFieldComponentPath } },
      relationTo: ['users'],
    })

    expect(getActivityLogCustomConfig(result)).toEqual({
      collectionSlug: 'activity-log',
      events: defaultEvents,
      ipAddress: false,
      requestHost: false,
      resolveUserLabel: null,
      retention: null,
      snapshot: 'delete',
      userCollections: ['users'],
    })
  })

  it('supports selections, custom slug, event toggles, and collection override', async () => {
    const result = await activityLogPlugin({
      collectionOverride: (collection) => ({
        ...collection,
        admin: { ...collection.admin, hidden: true },
      }),
      collections: { exclude: ['tags'] },
      collectionSlug: 'audit-trail',
      events: { login: false, logout: false },
      globals: [],
    })(baseConfig() as Config)

    expect(getCollection(result, 'tags').hooks?.afterChange).toBeUndefined()
    expect(getCollection(result, 'posts').hooks?.afterChange).toHaveLength(1)
    expect(getCollection(result, 'users').hooks?.afterLogin).toBeUndefined()
    expect(result.globals?.[0]?.hooks?.afterChange).toBeUndefined()
    expect(getCollection(result, 'audit-trail').admin?.hidden).toBe(true)
    expect(result.collections?.some((c) => c.slug === 'activity-log')).toBe(false)
  })

  it('throws when the log slug collides with an existing collection', () => {
    const config = baseConfig() as Config
    config.collections!.push({ slug: 'activity-log', fields: [] })
    expect(() => activityLogPlugin()(config)).toThrow(/already exists/)
  })

  it('logs create and update with version id, title, and changed fields', async () => {
    const context = {
      events: defaultEvents,
      logSlug: 'activity-log',
      retention: null,
      snapshot: 'delete',
    } as const
    const hook = logCollectionAfterChange(context)
    const collection = { slug: 'posts', versions: { drafts: true } } as never
    const { created, req } = buildReq()

    await hook({
      collection,
      context: {},
      doc: { id: 'post-1', title: 'Hello' },
      operation: 'create',
      req,
    } as never)

    expect(created[0]).toMatchObject({
      collection: 'activity-log',
      data: {
        collectionSlug: 'posts',
        documentId: 'post-1',
        documentTitle: 'Hello',
        operation: 'create',
        user: { relationTo: 'users', value: 'user-1' },
        userLabel: 'a@b.co',
        versionId: 'version-1',
      },
    })
    expect(created[0].data.snapshot).toBeUndefined()

    await hook({
      collection,
      context: {},
      doc: { id: 'post-1', title: 'Hello again', updatedAt: 'now' },
      operation: 'update',
      previousDoc: { id: 'post-1', title: 'Hello', updatedAt: 'before' },
      req,
    } as never)

    expect(created[1].data).toMatchObject({
      changedFields: ['title'],
      operation: 'update',
    })
  })

  it('classifies deletedAt transitions on trash-enabled collections', async () => {
    const context = {
      events: defaultEvents,
      logSlug: 'activity-log',
      retention: null,
      snapshot: 'delete',
    } as const
    const hook = logCollectionAfterChange(context)
    const collection = { slug: 'posts', trash: true } as never
    const { created, req } = buildReq()

    await hook({
      collection,
      context: {},
      doc: { id: 'post-1', deletedAt: '2026-01-01T00:00:00.000Z', title: 'Hello' },
      operation: 'update',
      previousDoc: { id: 'post-1', deletedAt: null, title: 'Hello' },
      req,
    } as never)
    await hook({
      collection,
      context: {},
      doc: { id: 'post-1', deletedAt: null, title: 'Hello' },
      operation: 'update',
      previousDoc: { id: 'post-1', deletedAt: '2026-01-01T00:00:00.000Z', title: 'Hello' },
      req,
    } as never)

    expect(created[0].data).toMatchObject({ changedFields: [], operation: 'trash' })
    expect(created[1].data).toMatchObject({ changedFields: [], operation: 'restore' })
  })

  it('skips autosaves by default and system writes without a user', async () => {
    const context = {
      events: defaultEvents,
      logSlug: 'activity-log',
      retention: null,
      snapshot: 'delete',
    } as const
    const hook = logCollectionAfterChange(context)
    const collection = { slug: 'posts' } as never

    const autosave = buildReq({ query: { autosave: 'true', draft: 'true' } })
    await hook({
      collection,
      context: {},
      doc: { id: 'post-1' },
      operation: 'update',
      previousDoc: { id: 'post-1' },
      req: autosave.req,
    } as never)
    expect(autosave.created).toHaveLength(0)

    const system = buildReq({ user: null })
    await hook({
      collection,
      context: {},
      doc: { id: 'post-1' },
      operation: 'create',
      req: system.req,
    } as never)
    expect(system.created).toHaveLength(0)
  })

  it('logs deletes with a snapshot unless snapshots are disabled', async () => {
    const collection = { slug: 'posts' } as never
    const doc = { id: 'post-1', title: 'Hello' }

    const withSnapshot = buildReq()
    await logCollectionAfterDelete({
      events: defaultEvents,
      logSlug: 'activity-log',
      retention: null,
      snapshot: 'delete',
    })({ id: 'post-1', collection, context: {}, doc, req: withSnapshot.req } as never)
    expect(withSnapshot.created[0].data).toMatchObject({
      operation: 'delete',
      snapshot: { id: 'post-1', title: 'Hello' },
    })

    const withoutSnapshot = buildReq()
    await logCollectionAfterDelete({
      events: defaultEvents,
      logSlug: 'activity-log',
      retention: null,
      snapshot: 'never',
    })({ id: 'post-1', collection, context: {}, doc, req: withoutSnapshot.req } as never)
    expect(withoutSnapshot.created[0].data.snapshot).toBeUndefined()
  })

  it('reuses audit-fields resolveUserLabel from config.custom when not overridden', async () => {
    const collection = { slug: 'posts' } as never
    const { created, req } = buildReq()
    ;(req.payload.config.custom as Record<string, unknown>)['@whatworks/payload-audit-fields'] = {
      resolveUserLabel: () => 'from-audit-fields',
    }

    await logCollectionAfterChange({
      events: defaultEvents,
      logSlug: 'activity-log',
      retention: null,
      snapshot: 'delete',
    })({ collection, context: {}, doc: { id: 'post-1' }, operation: 'create', req } as never)

    expect(created[0].data.userLabel).toBe('from-audit-fields')
  })

  it('stores the requester IP for every operation when ipAddress is enabled', async () => {
    const clientHeaders = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    const changeArgs = {
      collection: { slug: 'posts' } as never,
      context: {},
      doc: { id: 'post-1', title: 'Hello' },
      operation: 'create',
    }

    // Off by default: no field, no column, nothing stored even with headers present.
    const offResult = await activityLogPlugin()(baseConfig() as Config)
    const offLog = getCollection(offResult, 'activity-log')
    expect(offLog.fields.some((f) => 'name' in f && f.name === 'ipAddress')).toBe(false)
    expect(offLog.admin?.defaultColumns).not.toContain('ipAddress')
    const off = buildReq({ headers: clientHeaders })
    await getCollection(offResult, 'posts').hooks?.afterChange?.[0]?.({
      ...changeArgs,
      req: off.req,
    } as never)
    expect('ipAddress' in off.created[0].data).toBe(false)

    // Enabled: schema gains the field/column and a plain document write carries
    // the first x-forwarded-for hop — tracking covers all operations, not just auth.
    const onResult = await activityLogPlugin({ ipAddress: true })(baseConfig() as Config)
    const onLog = getCollection(onResult, 'activity-log')
    expect(onLog.fields.some((f) => 'name' in f && f.name === 'ipAddress')).toBe(true)
    expect(onLog.admin?.defaultColumns).toContain('ipAddress')
    expect(getActivityLogCustomConfig(onResult)?.ipAddress).toBe(true)
    const on = buildReq({ headers: clientHeaders })
    await getCollection(onResult, 'posts').hooks?.afterChange?.[0]?.({
      ...changeArgs,
      req: on.req,
    } as never)
    expect(on.created[0].data.ipAddress).toBe('203.0.113.7')

    // A custom resolver replaces header parsing entirely.
    const customResult = await activityLogPlugin({ ipAddress: () => 'custom-ip' })(
      baseConfig() as Config,
    )
    const custom = buildReq()
    await getCollection(customResult, 'posts').hooks?.afterChange?.[0]?.({
      ...changeArgs,
      req: custom.req,
    } as never)
    expect(custom.created[0].data.ipAddress).toBe('custom-ip')
  })

  it('stores the request host for every operation when requestHost is enabled', async () => {
    const clientHeaders = new Headers({
      'x-forwarded-host': 'tenant-a.example.com, proxy.internal',
    })
    const changeArgs = {
      collection: { slug: 'posts' } as never,
      context: {},
      doc: { id: 'post-1', title: 'Hello' },
      operation: 'create',
    }

    // Off by default: no field, no column, nothing stored even with headers present.
    const offResult = await activityLogPlugin()(baseConfig() as Config)
    const offLog = getCollection(offResult, 'activity-log')
    expect(offLog.fields.some((f) => 'name' in f && f.name === 'requestHost')).toBe(false)
    expect(offLog.admin?.defaultColumns).not.toContain('requestHost')
    const off = buildReq({ headers: clientHeaders })
    await getCollection(offResult, 'posts').hooks?.afterChange?.[0]?.({
      ...changeArgs,
      req: off.req,
    } as never)
    expect('requestHost' in off.created[0].data).toBe(false)

    // Enabled: schema gains the field/column and a plain document write carries
    // the first x-forwarded-host hop — tracking covers all operations.
    const onResult = await activityLogPlugin({ requestHost: true })(baseConfig() as Config)
    const onLog = getCollection(onResult, 'activity-log')
    expect(onLog.fields.some((f) => 'name' in f && f.name === 'requestHost')).toBe(true)
    expect(onLog.admin?.defaultColumns).toContain('requestHost')
    expect(getActivityLogCustomConfig(onResult)?.requestHost).toBe(true)
    const on = buildReq({ headers: clientHeaders })
    await getCollection(onResult, 'posts').hooks?.afterChange?.[0]?.({
      ...changeArgs,
      req: on.req,
    } as never)
    expect(on.created[0].data.requestHost).toBe('tenant-a.example.com')

    // A custom resolver replaces header parsing entirely.
    const customResult = await activityLogPlugin({ requestHost: () => 'custom-host' })(
      baseConfig() as Config,
    )
    const custom = buildReq()
    await getCollection(customResult, 'posts').hooks?.afterChange?.[0]?.({
      ...changeArgs,
      req: custom.req,
    } as never)
    expect(custom.created[0].data.requestHost).toBe('custom-host')
  })

  it('getChangedFields ignores bookkeeping keys and compares deeply', () => {
    expect(
      getChangedFields({
        doc: {
          id: 1,
          content: { a: [1, 2] },
          deletedAt: 'x',
          tags: ['a'],
          title: 'New',
          updatedAt: 'now',
        },
        previousDoc: {
          id: 1,
          content: { a: [1, 2] },
          deletedAt: null,
          tags: ['a', 'b'],
          title: 'Old',
          updatedAt: 'before',
        },
      }),
    ).toEqual(['tags', 'title'])
  })

  it('default resolvers prefer human labels and skip the useAsTitle id quirk', async () => {
    const req = {
      payload: {
        collections: {
          posts: { config: { admin: { useAsTitle: 'title' } } },
          users: { config: { admin: { useAsTitle: 'id' } } },
        },
        globals: { config: [{ slug: 'settings', label: 'Site Settings' }] },
      },
    } as unknown as PayloadRequest

    expect(
      await defaultResolveUserLabel({ relationTo: 'users', req, user: { id: 1, email: 'a@b.co' } }),
    ).toBe('a@b.co')
    expect(
      await defaultResolveDocumentLabel({
        collectionSlug: 'posts',
        doc: { id: 'p1', title: 'Hello' },
        req,
      }),
    ).toBe('Hello')
    expect(
      await defaultResolveDocumentLabel({
        collectionSlug: 'users',
        doc: { id: 'u1', email: 'a@b.co' },
        req,
      }),
    ).toBe('a@b.co')
    expect(await defaultResolveDocumentLabel({ doc: { id: 1 }, globalSlug: 'settings', req })).toBe(
      'Site Settings',
    )
  })

  it('stores custom resolvers and settings under the plugin key', async () => {
    const resolveUserLabel = () => 'someone'
    const result = await activityLogPlugin({
      resolveUserLabel,
      retention: { maxAgeDays: 30 },
      snapshot: 'never',
    })(baseConfig() as Config)

    expect(result.custom?.[pluginKey]).toMatchObject({
      resolveUserLabel,
      retention: { maxAgeDays: 30 },
      snapshot: 'never',
    })
  })

  it('createBatcher groups same-tick loads into one query per scope', async () => {
    const runBatch = vi.fn((scope: string, ids: string[]) =>
      scope === 'broken'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(
            new Map(ids.filter((id) => id !== 'gone').map((id) => [id, `${scope}:${id}`])),
          ),
    )
    const load = createBatcher<string>(runBatch, { notFound: 'missing', onError: 'error' })

    const results = await Promise.all([
      load('posts', 'a'),
      load('posts', 'b'),
      load('posts', 'gone'),
      load('tags', 'a'),
      load('broken', 'x'),
    ])

    expect(results).toEqual(['posts:a', 'posts:b', 'missing', 'tags:a', 'error'])
    // One flush → one runBatch call per scope, with posts ids batched together.
    expect(runBatch).toHaveBeenCalledTimes(3)
    expect(runBatch).toHaveBeenCalledWith('posts', ['a', 'b', 'gone'])
  })
})

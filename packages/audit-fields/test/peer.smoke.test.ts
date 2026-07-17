import type { CollectionConfig, Config, Field, PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import {
  auditFieldsPlugin,
  auditUserCellComponentPath,
  auditUserFieldComponentPath,
  createAuditField,
  defaultResolveUserLabel,
  getAuditFieldsCustomConfig,
  pluginKey,
  setCollectionAuditFields,
  versionsViewComponentPath,
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

const fieldNames = (fields: Field[]): string[] =>
  fields.map((field) => ('name' in field ? field.name : '')).filter(Boolean)

describe('@whatworks/payload-audit-fields peer smoke', () => {
  it('createAuditField returns a read-only polymorphic relationship field with display and cell components', () => {
    const field = createAuditField({
      name: 'createdBy',
      entitySlug: 'posts',
      index: false,
      label: 'Created By',
      showInSidebar: true,
      userCollections: ['users'],
    })
    expect(field.type).toBe('relationship')
    expect(field.relationTo).toEqual(['users'])
    expect(field.admin?.readOnly).toBe(true)
    expect(field.admin?.position).toBe('sidebar')
    expect(field.admin?.components?.Field).toBe(auditUserFieldComponentPath)
    expect(field.admin?.components?.Cell).toBe(auditUserCellComponentPath)
  })

  it('adds audit fields, hooks, and the versions view to every entity by default', async () => {
    const result = await auditFieldsPlugin()(baseConfig() as Config)

    for (const slug of ['users', 'posts', 'tags']) {
      const collection = getCollection(result, slug)
      expect(fieldNames(collection.fields)).toEqual(
        expect.arrayContaining(['createdBy', 'lastModifiedBy']),
      )
      expect(collection.hooks?.beforeChange).toHaveLength(1)
    }

    const posts = getCollection(result, 'posts')
    expect(posts.admin?.components?.views?.edit).toMatchObject({
      versions: { Component: versionsViewComponentPath },
    })

    // Fields live in the main field area unless showInSidebar is enabled.
    const createdBy = posts.fields.find((f) => 'name' in f && f.name === 'createdBy')
    expect(createdBy && 'admin' in createdBy ? createdBy.admin?.position : null).toBeUndefined()

    // No versions on tags — no view override.
    const tags = getCollection(result, 'tags')
    expect(tags.admin?.components?.views?.edit).toBeUndefined()

    const settings = result.globals?.[0]
    expect(fieldNames(settings?.fields ?? [])).toEqual(
      expect.arrayContaining(['createdBy', 'lastModifiedBy']),
    )
    expect(settings?.admin?.components?.views?.edit).toMatchObject({
      versions: { Component: versionsViewComponentPath },
    })

    expect(getAuditFieldsCustomConfig(result)).toEqual({
      createdByFieldName: 'createdBy',
      lastModifiedByFieldName: 'lastModifiedBy',
      resolveUserLabel: defaultResolveUserLabel,
      userCollections: ['users'],
      versionsColumnLabel: null,
    })
  })

  it('places audit fields in the sidebar when showInSidebar is enabled', async () => {
    const result = await auditFieldsPlugin({ showInSidebar: true })(baseConfig() as Config)
    const posts = getCollection(result, 'posts')
    const createdBy = posts.fields.find((f) => 'name' in f && f.name === 'createdBy')
    expect(createdBy && 'admin' in createdBy ? createdBy.admin?.position : null).toBe('sidebar')
  })

  it('supports exclude selections and disabling the versions view', async () => {
    const result = await auditFieldsPlugin({
      collections: { exclude: ['tags'] },
      versionsView: false,
    })(baseConfig() as Config)

    expect(fieldNames(getCollection(result, 'tags').fields)).toEqual([])
    expect(fieldNames(getCollection(result, 'posts').fields)).toContain('createdBy')
    expect(getCollection(result, 'posts').admin?.components?.views).toBeUndefined()
  })

  it('leaves entities that already define an audit field untouched', async () => {
    const config = baseConfig() as Config
    config.collections![1].fields.push({ name: 'createdBy', type: 'text' })

    const result = await auditFieldsPlugin({ fields: { lastModifiedBy: false } })(config)
    const posts = getCollection(result, 'posts')

    expect(posts.hooks?.beforeChange).toBeUndefined()
    expect(fieldNames(posts.fields).filter((name) => name === 'createdBy')).toHaveLength(1)
  })

  it('respects an existing custom versions view', async () => {
    const config = baseConfig() as Config
    config.collections![1].admin = {
      components: { views: { edit: { versions: { Component: 'custom#View' } } } },
    }

    const result = await auditFieldsPlugin()(config)
    expect(getCollection(result, 'posts').admin?.components?.views?.edit).toMatchObject({
      versions: { Component: 'custom#View' },
    })
  })

  it('hook attributes create and update to req.user and guards createdBy', async () => {
    const hook = setCollectionAuditFields({
      createdByFieldName: 'createdBy',
      lastModifiedByFieldName: 'lastModifiedBy',
    })
    const req = { user: { id: 1, collection: 'users' } } as unknown as PayloadRequest
    const collection = { slug: 'posts' } as CollectionConfig

    const created = await hook({
      collection,
      context: {},
      data: {},
      operation: 'create',
      req,
    } as never)
    expect(created).toMatchObject({
      createdBy: { relationTo: 'users', value: 1 },
      lastModifiedBy: { relationTo: 'users', value: 1 },
    })

    const updated = await hook({
      collection,
      context: {},
      data: { createdBy: { relationTo: 'users', value: 999 }, title: 'x' },
      operation: 'update',
      req,
    } as never)
    expect(updated).toMatchObject({
      lastModifiedBy: { relationTo: 'users', value: 1 },
      title: 'x',
    })
    expect(updated).not.toHaveProperty('createdBy')

    const system = await hook({
      collection,
      context: {},
      data: { title: 'x' },
      operation: 'update',
      req: { user: null } as unknown as PayloadRequest,
    } as never)
    expect(system).toEqual({ title: 'x' })
  })

  it('defaultResolveUserLabel prefers email, then username, then the ID', async () => {
    const req = {} as PayloadRequest
    expect(
      await defaultResolveUserLabel({
        relationTo: 'users',
        req,
        user: { id: 1, email: 'a@b.co', username: 'ab' },
      }),
    ).toBe('a@b.co')
    expect(
      await defaultResolveUserLabel({ relationTo: 'users', req, user: { id: 1, username: 'ab' } }),
    ).toBe('ab')
    expect(await defaultResolveUserLabel({ relationTo: 'users', req, user: { id: 1 } })).toBe('1')
  })

  it('stores a custom resolveUserLabel and column label under the plugin key', async () => {
    const resolveUserLabel = () => 'someone'
    const result = await auditFieldsPlugin({
      resolveUserLabel,
      versionsView: { columnLabel: 'Author' },
    })(baseConfig() as Config)
    expect(result.custom?.[pluginKey]).toMatchObject({
      resolveUserLabel,
      versionsColumnLabel: 'Author',
    })
  })
})

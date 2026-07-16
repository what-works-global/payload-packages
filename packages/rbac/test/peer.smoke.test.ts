import type {
  Access,
  CollectionConfig,
  Config,
  Payload,
  PayloadRequest,
  RelationshipField,
  SelectField,
} from 'payload'

import { describe, expect, it, vi } from 'vitest'

import {
  createAssignFirstUserRoleHook,
  createProtectCredentialsHook,
  createProtectedRolesChangeHook,
  createProtectedRolesDeleteHook,
  createProtectLastAdminChangeHook,
  createProtectLastAdminDeleteHook,
  createProtectRolesCollectionHook,
  createProtectRolesFieldHook,
  createRbacAccess,
  createRolesFieldAccess,
  findFullAccessRoleIds,
  fullAccessPermissions,
  getRbacCustomConfig,
  getUserPermissions,
  isTransientMongoError,
  isWriteConflict,
  missingPermissions,
  permissionCovers,
  permissionsGrant,
  permissionsMatrixFieldPath,
  rbacPlugin,
  requirePermission,
  retryOnWriteConflict,
  seedPredefinedRoles,
  warnIfAdminRoleUnheld,
} from '../src/index.js'
// Internal utilities — not part of the public API, so imported by path.
import { ensureRolesIndexes } from '../src/utilities/ensureRolesIndexes.js'
import { isUniqueViolation } from '../src/utilities/isUniqueViolation.js'

const baseConfig = (): Config =>
  ({
    admin: { user: 'users' },
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'posts', fields: [{ name: 'title', type: 'text' }], versions: { drafts: true } },
      { slug: 'tags', access: { read: () => true }, fields: [] },
    ],
    globals: [{ slug: 'site-settings', fields: [] }],
  }) as unknown as Config

const getCollection = (config: Config, slug: string): CollectionConfig => {
  const collection = config.collections?.find((c) => c.slug === slug)
  if (!collection) {
    throw new Error(`Collection ${slug} missing`)
  }
  return collection
}

type FakeUser = {
  collection?: string
  id: number | string
  roles?: unknown[]
} | null

const makeReq = (
  config: Config,
  user: FakeUser,
  payloadOverrides: Record<string, unknown> = {},
): PayloadRequest => {
  return {
    payload: {
      config,
      count: vi.fn(() => Promise.resolve({ totalDocs: 0 })),
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { info: vi.fn(), warn: vi.fn() },
      ...payloadOverrides,
    },
    user,
  } as unknown as PayloadRequest
}

const role = (id: number, permissions: string[]) => ({ id, permissions })

describe('@whatworks/payload-rbac peer smoke', () => {
  it('adds a roles collection with matrix options and the matrix field component', async () => {
    const result = await rbacPlugin()(baseConfig())
    const roles = getCollection(result, 'roles')

    expect(roles.admin?.useAsTitle).toBe('name')

    const permissionsField = roles.fields.find(
      (f) => 'name' in f && f.name === 'permissions',
    ) as SelectField
    expect(permissionsField.type).toBe('select')
    expect(permissionsField.hasMany).toBe(true)

    const values = permissionsField.options.map((o) => (typeof o === 'string' ? o : o.value))
    expect(values).toEqual(
      expect.arrayContaining(['*', 'posts:read', 'roles:update', 'site-settings:read']),
    )
    expect(values).not.toContain('site-settings:create')
    expect(values).not.toContain('site-settings:delete')

    const component = permissionsField.admin?.components?.Field
    expect(component).toMatchObject({ path: permissionsMatrixFieldPath })
    const rows = (component as { clientProps: { rows: { actions: string[]; slug: string }[] } })
      .clientProps.rows
    expect(rows.find((r) => r.slug === 'posts')?.actions).toEqual([
      'create',
      'read',
      'update',
      'delete',
    ])
    expect(rows.find((r) => r.slug === 'site-settings')?.actions).toEqual(['read', 'update'])

    expect(getRbacCustomConfig(result)).toEqual({
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
      userCollections: ['users'],
    })
  })

  it('injects the roles field into auth collections only', async () => {
    const result = await rbacPlugin()(baseConfig())

    const users = getCollection(result, 'users')
    const rolesField = users.fields.find((f) => 'name' in f && f.name === 'roles')
    expect(rolesField).toMatchObject({
      type: 'relationship',
      hasMany: true,
      relationTo: 'roles',
      saveToJWT: true,
    })

    const posts = getCollection(result, 'posts')
    expect(posts.fields.some((f) => 'name' in f && f.name === 'roles')).toBe(false)
  })

  it('fills access gaps and keeps explicit access functions', async () => {
    const config = baseConfig()
    const explicitRead = getCollection(config, 'tags').access?.read
    const result = await rbacPlugin()(config)

    const posts = getCollection(result, 'posts')
    for (const op of ['create', 'read', 'update', 'delete', 'readVersions', 'unlock'] as const) {
      expect(posts.access?.[op]).toBeTypeOf('function')
    }

    const tags = getCollection(result, 'tags')
    expect(tags.access?.read).toBe(explicitRead)
    expect(tags.access?.update).toBeTypeOf('function')

    const settings = result.globals?.find((g) => g.slug === 'site-settings')
    expect(settings?.access?.read).toBeTypeOf('function')
    expect(settings?.access?.update).toBeTypeOf('function')
  })

  it('denies anonymous requests and grants based on role permissions', async () => {
    const result = await rbacPlugin()(baseConfig())
    const posts = getCollection(result, 'posts')
    const read = posts.access?.read as Access
    const update = posts.access?.update as Access

    expect(await read({ req: makeReq(result, null) } as never)).toBe(false)

    const reader = makeReq(result, { id: 1, collection: 'users', roles: [role(1, ['posts:read'])] })
    expect(await read({ req: reader } as never)).toBe(true)
    expect(await update({ req: reader } as never)).toBe(false)

    const admin = makeReq(result, { id: 2, collection: 'users', roles: [role(2, ['*'])] })
    expect(await read({ req: admin } as never)).toBe(true)
    expect(await update({ req: admin } as never)).toBe(true)
  })

  it('resolves role IDs through one memoized find per request', async () => {
    const result = await rbacPlugin()(baseConfig())
    const find = vi.fn(() => Promise.resolve({ docs: [role(7, ['posts:read'])] }))
    const req = makeReq(result, { id: 1, collection: 'users', roles: [7] }, { find })

    expect((await getUserPermissions(req)).has('posts:read')).toBe(true)
    await getUserPermissions(req)
    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'roles', overrideAccess: true }),
    )
  })

  it('lets users read and update their own account without a permission', async () => {
    const result = await rbacPlugin()(baseConfig())
    const users = getCollection(result, 'users')
    const read = users.access?.read as Access
    const del = users.access?.delete as Access

    const self = makeReq(result, { id: 5, collection: 'users', roles: [] })
    expect(await read({ req: self } as never)).toEqual({ id: { equals: 5 } })
    expect(await del({ req: self } as never)).toBe(false)

    const disabled = await rbacPlugin({ ownAccountAccess: false })(baseConfig())
    const readDisabled = getCollection(disabled, 'users').access?.read as Access
    expect(
      await readDisabled({
        req: makeReq(disabled, { id: 5, collection: 'users', roles: [] }),
      } as never),
    ).toBe(false)
  })

  it('requirePermission composes into custom access control', async () => {
    const result = await rbacPlugin()(baseConfig())
    const access = requirePermission('posts:update')
    const editor = makeReq(result, {
      id: 1,
      collection: 'users',
      roles: [role(1, ['posts:update'])],
    })
    expect(await access({ req: editor } as never)).toBe(true)
    expect(await access({ req: makeReq(result, null) } as never)).toBe(false)
  })

  it('blocks assigning roles whose permissions the assigner does not hold', async () => {
    const result = await rbacPlugin()(baseConfig())
    const hook = createProtectRolesFieldHook({
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    const usersCollection = { slug: 'users' }

    const find = vi.fn(() =>
      Promise.resolve({ docs: [{ id: 9, name: 'admin', permissions: ['*'] }] }),
    )
    const editor = makeReq(
      result,
      { id: 1, collection: 'users', roles: [role(1, ['posts:read'])] },
      { find },
    )

    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [9] },
        originalDoc: { roles: [] },
        req: editor,
      } as never),
    ).rejects.toThrow(/cannot assign the role "admin"/)

    // Keeping an already-assigned role is not an escalation.
    const kept = await hook({
      collection: usersCollection,
      data: { email: 'x@y.z', roles: [9] },
      originalDoc: { roles: [9] },
      req: editor,
    } as never)
    expect(kept).toEqual({ email: 'x@y.z', roles: [9] })

    // Users with '*' and system writes may assign anything.
    const admin = makeReq(result, { id: 2, collection: 'users', roles: [role(2, ['*'])] }, { find })
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [9] },
        originalDoc: {},
        req: admin,
      } as never),
    ).resolves.toEqual({ roles: [9] })
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [9] },
        originalDoc: {},
        req: makeReq(result, null),
      } as never),
    ).resolves.toEqual({ roles: [9] })
  })

  it("blocks widening a role beyond the editing user's own permissions", async () => {
    const result = await rbacPlugin()(baseConfig())
    const hook = createProtectRolesCollectionHook()
    const editor = makeReq(result, {
      id: 1,
      collection: 'users',
      roles: [role(1, ['posts:read', 'posts:update'])],
    })

    await expect(
      hook({
        data: { permissions: ['posts:read', 'tags:delete'] },
        originalDoc: { permissions: ['posts:read'] },
        req: editor,
      } as never),
    ).rejects.toThrow(/cannot grant permissions you do not hold: tags:delete/)

    await expect(
      hook({
        data: { permissions: ['posts:read', 'posts:update'] },
        originalDoc: { permissions: ['posts:read'] },
        req: editor,
      } as never),
    ).resolves.toBeTruthy()

    // Protected roles are exempt: the protected-role guard already limits writes
    // to the exact code definition, and restoring a drifted role must work even
    // when the restorer no longer holds the permissions being restored.
    const withProtected = createProtectRolesCollectionHook({ protectedRoleNames: ['admin'] })
    await expect(
      withProtected({
        data: { permissions: ['*'] },
        originalDoc: { name: 'admin', permissions: ['posts:read'] },
        req: editor,
      } as never),
    ).resolves.toBeTruthy()
  })

  it('locks protected roles to their code definition', async () => {
    const result = await rbacPlugin()(baseConfig())
    const hook = createProtectedRolesChangeHook({
      protectedRoles: [{ name: 'admin', permissions: ['*'], protected: true }],
    })
    const admin = makeReq(result, { id: 1, collection: 'users', roles: [role(1, ['*'])] })

    // Even a '*' holder cannot downgrade, rename, or extend a protected role.
    expect(() =>
      hook({
        data: { permissions: ['posts:read'] },
        originalDoc: { name: 'admin', permissions: ['*'] },
        req: admin,
      } as never),
    ).toThrow(/protected — its permissions are defined in code/)
    expect(() =>
      hook({
        data: { name: 'superuser' },
        originalDoc: { name: 'admin', permissions: ['*'] },
        req: admin,
      } as never),
    ).toThrow(/protected and cannot be renamed/)

    // Restoring the exact code definition and touching other fields is allowed.
    expect(
      hook({
        data: { description: 'Updated', permissions: ['*'] },
        originalDoc: { name: 'admin', permissions: ['posts:read'] },
        req: admin,
      } as never),
    ).toEqual({ description: 'Updated', permissions: ['*'] })

    // Unprotected roles and system writes pass through.
    expect(
      hook({
        data: { permissions: ['posts:read'] },
        originalDoc: { name: 'editor', permissions: ['posts:update'] },
        req: admin,
      } as never),
    ).toBeTruthy()
    expect(
      hook({
        data: { permissions: ['posts:read'] },
        originalDoc: { name: 'admin', permissions: ['*'] },
        req: makeReq(result, null),
      } as never),
    ).toBeTruthy()

    // Creating a role under a protected name must match the code definition too.
    expect(() => hook({ data: { name: 'admin', permissions: [] }, req: admin } as never)).toThrow(
      /protected/,
    )
  })

  it('blocks deleting protected roles', async () => {
    const result = await rbacPlugin()(baseConfig())
    const hook = createProtectedRolesDeleteHook({
      protectedRoleNames: ['admin'],
      rolesCollectionSlug: 'roles',
    })
    const findByID = vi.fn(() => Promise.resolve({ id: 9, name: 'admin' }))
    const admin = makeReq(
      result,
      { id: 1, collection: 'users', roles: [role(1, ['*'])] },
      { findByID },
    )

    await expect(hook({ id: 9, req: admin } as never)).rejects.toThrow(
      /protected and cannot be deleted/,
    )
    await expect(hook({ id: 9, req: makeReq(result, null, { findByID }) } as never)).resolves.toBe(
      undefined,
    )

    const findOther = vi.fn(() => Promise.resolve({ id: 3, name: 'editor' }))
    await expect(
      hook({
        id: 3,
        req: makeReq(result, { id: 1, collection: 'users', roles: [] }, { findByID: findOther }),
      } as never),
    ).resolves.toBe(undefined)
  })

  it('defines the adminRole as a protected full-access role and wires the guards', async () => {
    const result = await rbacPlugin({
      adminRole: 'admin',
      roles: [{ name: 'editor', permissions: ['posts:read'] }],
    })(baseConfig())
    const roles = getCollection(result, 'roles')

    // protected-role guard + escalation guard, and a delete guard.
    expect(roles.hooks?.beforeChange).toHaveLength(2)
    expect(roles.hooks?.beforeDelete).toHaveLength(1)

    const permissionsField = roles.fields.find(
      (f) => 'name' in f && f.name === 'permissions',
    ) as SelectField
    const clientProps = (
      permissionsField.admin?.components?.Field as {
        clientProps: { protectedRoleNames: string[] }
      }
    ).clientProps
    expect(clientProps.protectedRoleNames).toEqual(['admin'])

    // Only the protected-change guard: the admin role cannot be downgraded even
    // by a '*' user, while the editor role stays editable.
    const guard = roles.hooks?.beforeChange?.[0]
    const admin = makeReq(result, { id: 1, collection: 'users', roles: [role(1, ['*'])] })
    expect(() =>
      guard?.({
        data: { permissions: [] },
        originalDoc: { name: 'admin', permissions: ['*'] },
        req: admin,
      } as never),
    ).toThrow(/protected/)

    // The adminRole is seeded with ['*'] on init.
    const create = vi.fn()
    const payload = {
      create,
      db: { name: 'postgres' },
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload
    await result.onInit?.(payload)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'roles',
        data: expect.objectContaining({ name: 'admin', permissions: ['*'] }),
      }),
    )

    // Without an adminRole and with only unprotected roles, no protected guards.
    const plain = await rbacPlugin({
      roles: [{ name: 'editor', permissions: ['posts:read'] }],
    })(baseConfig())
    expect(getCollection(plain, 'roles').hooks?.beforeChange).toHaveLength(1)
    expect(getCollection(plain, 'roles').hooks?.beforeDelete).toBeUndefined()
  })

  it('repairs drifted permissions of protected roles on seed', async () => {
    const create = vi.fn()
    const update = vi.fn()
    const find = vi
      .fn()
      .mockResolvedValueOnce({ docs: [{ id: 1, name: 'admin', permissions: ['posts:read'] }] })
      .mockResolvedValueOnce({ docs: [{ id: 2, name: 'editor', permissions: ['posts:read'] }] })
    const payload = {
      create,
      db: { name: 'postgres' },
      find,
      logger: { info: vi.fn(), warn: vi.fn() },
      update,
    } as unknown as Payload

    await seedPredefinedRoles(payload, {
      roles: [
        { name: 'admin', permissions: ['*'], protected: true },
        // Unprotected drift is left alone — the database wins.
        { name: 'editor', permissions: ['posts:read', 'posts:update'] },
      ],
      rolesCollectionSlug: 'roles',
    })

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, collection: 'roles', data: { permissions: ['*'] } }),
    )
  })

  it('locks assigning the admin role to users who already hold it', async () => {
    const result = await rbacPlugin({ adminRole: 'Super Admin' })(baseConfig())
    const hook = createProtectRolesFieldHook({
      breakGlass: { adminRoleName: 'Super Admin', userCollections: ['users'] },
      holderOnly: { roleNames: ['Super Admin'], userCollections: ['users'] },
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    const usersCollection = { slug: 'users' }

    // `holders` is what every holder count returns.
    const dbWith = (holders: number) => ({
      count: vi.fn(() => Promise.resolve({ totalDocs: holders })),
      find: vi.fn((findArgs: { where?: { id?: { in?: (number | string)[] } } }) => {
        const all = [
          { id: 9, name: 'Super Admin', permissions: ['*'] },
          { id: 3, name: 'Admin', permissions: ['*'] },
        ]
        const ids = findArgs.where?.id?.in
        return Promise.resolve({ docs: ids ? all.filter((r) => ids.includes(r.id)) : all })
      }),
    })
    const client = { id: 2, collection: 'users', roles: [role(3, ['*'])] }

    // A '*' client cannot grant the admin role — not even to themselves.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [3, 9] },
        originalDoc: { id: 2, roles: [3] },
        req: makeReq(result, client, dbWith(1)),
      } as never),
    ).rejects.toThrow(/can only be assigned by a user who holds it/)

    // A holder grants it freely, without any holder-count query.
    const holderReq = makeReq(
      result,
      { id: 1, collection: 'users', roles: [role(9, ['*'])] },
      dbWith(1),
    )
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [9] },
        originalDoc: { id: 5, roles: [] },
        req: holderReq,
      } as never),
    ).resolves.toBeTruthy()
    expect(holderReq.payload.count).not.toHaveBeenCalled()

    // While nobody holds the role at all (fresh rename, or the plugin newly
    // added to an existing project), a full-access user may step up…
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [3, 9] },
        originalDoc: { id: 2, roles: [3] },
        req: makeReq(result, client, dbWith(0)),
      } as never),
    ).resolves.toBeTruthy()

    // …but the ordinary permission check still applies to everyone else.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [9] },
        originalDoc: { id: 5, roles: [] },
        req: makeReq(result, { id: 2, collection: 'users', roles: [] }, dbWith(0)),
      } as never),
    ).rejects.toThrow(/cannot assign/)

    // The holder-only rule holds even with escalation protection disabled.
    const noEscalation = createProtectRolesFieldHook({
      holderOnly: { roleNames: ['Super Admin'], userCollections: ['users'] },
      preventEscalation: false,
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    await expect(
      noEscalation({
        collection: usersCollection,
        data: { roles: [3] },
        originalDoc: { id: 2, roles: [] },
        req: makeReq(result, { id: 2, collection: 'users', roles: [] }, dbWith(1)),
      } as never),
    ).resolves.toBeTruthy()
    await expect(
      noEscalation({
        collection: usersCollection,
        data: { roles: [9] },
        originalDoc: { id: 2, roles: [] },
        req: makeReq(result, { id: 2, collection: 'users', roles: [] }, dbWith(1)),
      } as never),
    ).rejects.toThrow(/can only be assigned by a user who holds it/)
  })

  it('locks the roles field to holders of roles:update', async () => {
    const result = await rbacPlugin({ adminRole: 'admin' })(baseConfig())

    // The generated field carries the gate on create and update; read stays open.
    const generatedField = getCollection(result, 'users').fields.find(
      (f) => 'name' in f && f.name === 'roles',
    ) as RelationshipField
    expect(generatedField.access?.create).toBeTypeOf('function')
    expect(generatedField.access?.update).toBeTypeOf('function')
    expect(generatedField.access?.read).toBeUndefined()

    const access = createRolesFieldAccess({
      breakGlass: { userCollections: ['users'] },
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })

    // Writes without a user — seeds, the first-user registration — pass through.
    expect(await access({ req: makeReq(result, null) } as never)).toBe(true)

    // `roles:update` (or '*') makes the field writable.
    expect(
      await access({
        req: makeReq(result, { id: 1, collection: 'users', roles: [role(1, ['roles:update'])] }),
      } as never),
    ).toBe(true)

    // Everyone else gets a read-only field — even on their own account — as
    // long as an administrator exists. `users:update` alone is not enough.
    const adminExists = {
      count: vi.fn(() => Promise.resolve({ totalDocs: 1 })),
      find: vi.fn(() => Promise.resolve({ docs: [{ id: 9, permissions: ['*'] }] })),
    }
    expect(
      await access({
        req: makeReq(
          result,
          { id: 2, collection: 'users', roles: [role(2, ['users:update'])] },
          adminExists,
        ),
      } as never),
    ).toBe(false)

    // While nobody holds full access the field stays writable, so the
    // break-glass self-claim can reach the escalation guard that vets it.
    const stranded = {
      count: vi.fn(() => Promise.resolve({ totalDocs: 0 })),
      find: vi.fn(() => Promise.resolve({ docs: [{ id: 9, permissions: ['*'] }] })),
    }
    expect(
      await access({
        req: makeReq(result, { id: 2, collection: 'users', roles: [] }, stranded),
      } as never),
    ).toBe(true)

    // Without an adminRole there is no break-glass path to hold open — the
    // field stays locked and no holder query is ever made.
    const noBreakGlass = createRolesFieldAccess({
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    const strandedReq = makeReq(
      result,
      { id: 2, collection: 'users', roles: [] },
      { count: vi.fn(() => Promise.resolve({ totalDocs: 0 })), find: vi.fn() },
    )
    expect(await noBreakGlass({ req: strandedReq } as never)).toBe(false)
    expect(strandedReq.payload.find).not.toHaveBeenCalled()

    // A user-defined roles field is left entirely alone.
    const custom = baseConfig()
    custom.collections
      ?.find((c) => c.slug === 'users')
      ?.fields.push({ name: 'roles', type: 'relationship', hasMany: true, relationTo: 'roles' })
    const customResult = await rbacPlugin({ adminRole: 'admin' })(custom)
    const customField = getCollection(customResult, 'users').fields.find(
      (f) => 'name' in f && f.name === 'roles',
    ) as RelationshipField
    expect(customField.access).toBeUndefined()
  })

  it('blocks removing roles from your own account that your kept roles cannot cover', async () => {
    const result = await rbacPlugin({ adminRole: 'admin' })(baseConfig())
    const hook = createProtectRolesFieldHook({
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    const usersCollection = { slug: 'users' }
    const db = {
      count: vi.fn(() => Promise.resolve({ totalDocs: 1 })),
      find: vi.fn((findArgs: { where?: { id?: { in?: (number | string)[] } } }) => {
        const all = [
          { id: 1, name: 'Admin', permissions: ['*'] },
          { id: 2, name: 'Viewer', permissions: ['posts:read'] },
          { id: 3, name: 'Editor', permissions: ['posts:update'] },
        ]
        const ids = findArgs.where?.id?.in
        return Promise.resolve({
          docs: ids ? all.filter((r) => ids.map(String).includes(String(r.id))) : all,
        })
      }),
    }
    const self = { id: 7, collection: 'users', roles: [role(1, ['*']), role(2, ['posts:read'])] }

    // Removing the role that grants your access: the kept roles cannot cover it,
    // so you could never assign it back.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [2] },
        originalDoc: { id: 7, roles: [1, 2] },
        req: makeReq(result, self, db),
      } as never),
    ).rejects.toThrow(/from your own account/)

    // Removing a role your kept roles fully cover is reversible and fine.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [1] },
        originalDoc: { id: 7, roles: [1, 2] },
        req: makeReq(result, self, db),
      } as never),
    ).resolves.toBeTruthy()

    // A swap that adds covered roles but drops the covering role still throws.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [2, 3] },
        originalDoc: { id: 7, roles: [1] },
        req: makeReq(result, self, db),
      } as never),
    ).rejects.toThrow(/from your own account/)

    // Dangling references (role documents deleted at the database level) grant
    // nothing and may always be removed.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [1] },
        originalDoc: { id: 7, roles: [99, 1] },
        req: makeReq(result, self, db),
      } as never),
    ).resolves.toBeTruthy()

    // Stripping roles from someone else stays unrestricted — that is
    // management, gated by the roles:update field access.
    await expect(
      hook({
        collection: usersCollection,
        data: { roles: [] },
        originalDoc: { id: 8, roles: [1, 2] },
        req: makeReq(result, self, db),
      } as never),
    ).resolves.toBeTruthy()

    // With escalation protection off, any removal can be re-assigned, so
    // self-removals pass.
    const noEscalation = createProtectRolesFieldHook({
      preventEscalation: false,
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    await expect(
      noEscalation({
        collection: usersCollection,
        data: { roles: [] },
        originalDoc: { id: 7, roles: [1, 2] },
        req: makeReq(result, self, db),
      } as never),
    ).resolves.toBeTruthy()
  })

  it('allows a break-glass self-claim of the admin role only while no administrator exists', async () => {
    const result = await rbacPlugin({ adminRole: 'admin' })(baseConfig())
    const hook = createProtectRolesFieldHook({
      breakGlass: { adminRoleName: 'admin', userCollections: ['users'] },
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    const usersCollection = { slug: 'users' }

    // `holders` is what the full-access holder count returns.
    const dbWith = (holders: number) => ({
      count: vi.fn(() => Promise.resolve({ totalDocs: holders })),
      find: vi.fn((findArgs: { where?: { id?: { in?: (number | string)[] } } }) => {
        const all = [
          { id: 9, name: 'admin', permissions: ['*'] },
          { id: 3, name: 'editor', permissions: ['posts:read'] },
        ]
        const ids = findArgs.where?.id?.in
        return Promise.resolve({ docs: ids ? all.filter((r) => ids.includes(r.id)) : all })
      }),
    })

    // A permissionless user claims the admin role for themselves — allowed,
    // because nobody in the system holds full access.
    const claim = {
      collection: usersCollection,
      data: { roles: [9] },
      originalDoc: { id: 1, roles: [] },
      req: makeReq(result, { id: 1, collection: 'users', roles: [] }, dbWith(0)),
    }
    await expect(hook(claim as never)).resolves.toEqual({ roles: [9] })

    // Blocked as soon as any user holds full access.
    await expect(
      hook({
        ...claim,
        req: makeReq(result, { id: 1, collection: 'users', roles: [] }, dbWith(1)),
      } as never),
    ).rejects.toThrow(/cannot assign/)

    // Only self-assignment is exempt — granting it to another user is blocked.
    await expect(hook({ ...claim, originalDoc: { id: 2, roles: [] } } as never)).rejects.toThrow(
      /cannot assign/,
    )

    // Only the admin role is exempt, even while stranded.
    await expect(hook({ ...claim, data: { roles: [3] } } as never)).rejects.toThrow(/cannot assign/)

    // Without breakGlass configured, a stranded self-claim stays blocked.
    const plainHook = createProtectRolesFieldHook({
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    await expect(plainHook(claim as never)).rejects.toThrow(/cannot assign/)

    // While stranded, signed-in users can read the roles collection so the
    // account page can list the admin role for the claim.
    const rolesRead = getCollection(result, 'roles').access?.read
    const strandedReq = makeReq(result, { id: 1, collection: 'users', roles: [] }, dbWith(0))
    await expect(rolesRead?.({ req: strandedReq } as never)).resolves.toBe(true)
    const heldReq = makeReq(result, { id: 1, collection: 'users', roles: [] }, dbWith(1))
    await expect(rolesRead?.({ req: heldReq } as never)).resolves.toBe(false)
    await expect(rolesRead?.({ req: makeReq(result, null, dbWith(0)) } as never)).resolves.toBe(
      false,
    )
  })

  it('warns on init when nobody holds the admin role', async () => {
    const args = {
      adminRoleName: 'admin',
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
      userCollections: ['users'],
    }
    const makePayload = (counts: number[], warn = vi.fn()) => {
      const count = vi.fn(() => Promise.resolve({ totalDocs: counts.shift() ?? 0 }))
      const find = vi.fn((findArgs: { where?: unknown }) =>
        Promise.resolve({
          docs: findArgs.where
            ? [{ id: 9, name: 'admin', permissions: ['*'] }]
            : [
                { id: 9, name: 'admin', permissions: ['*'] },
                { id: 7, name: 'old-admin', permissions: ['*'] },
              ],
        }),
      )
      return { count, find, logger: { info: vi.fn(), warn } } as unknown as Payload
    }

    // A holder exists — silent.
    const heldWarn = vi.fn()
    await warnIfAdminRoleUnheld(makePayload([1], heldWarn), args)
    expect(heldWarn).not.toHaveBeenCalled()

    // No users at all — silent; the first-user bootstrap covers it.
    const emptyWarn = vi.fn()
    await warnIfAdminRoleUnheld(makePayload([0, 0], emptyWarn), args)
    expect(emptyWarn).not.toHaveBeenCalled()

    // Unheld, but another role still grants '*' to someone — point at them.
    const renamedWarn = vi.fn()
    await warnIfAdminRoleUnheld(makePayload([0, 2, 1], renamedWarn), args)
    expect(renamedWarn).toHaveBeenCalledWith(
      expect.stringContaining('full access through another role'),
    )

    // Fully stranded — announce the break-glass.
    const strandedWarn = vi.fn()
    await warnIfAdminRoleUnheld(makePayload([0, 2, 0], strandedWarn), args)
    expect(strandedWarn).toHaveBeenCalledWith(
      expect.stringContaining('assign "admin" to themselves'),
    )
  })

  it('assigns the admin role on bootstrap creates only', async () => {
    const result = await rbacPlugin({ adminRole: 'admin' })(baseConfig())
    const hook = createAssignFirstUserRoleHook({
      firstUserRole: 'admin',
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
    })
    const collection = { slug: 'users' } as CollectionConfig

    // Existence check is a `find` (not `count`) so it is transaction-safe; it
    // returns no users on bootstrap and the role lookup returns the admin role.
    const bootstrapReq = makeReq(result, null, {
      find: vi.fn((args: { collection: string }) =>
        Promise.resolve(
          args.collection === 'roles' ? { docs: [{ id: 'r1', name: 'admin' }] } : { docs: [] },
        ),
      ),
    })
    const created = await hook({
      collection,
      data: { email: 'a@b.co' },
      operation: 'create',
      req: bootstrapReq,
    } as never)
    expect(created).toEqual({ email: 'a@b.co', roles: ['r1'] })

    // A user already exists → not the first user → left untouched.
    const laterReq = makeReq(result, null, {
      find: vi.fn((args: { collection: string }) =>
        Promise.resolve(
          args.collection === 'roles'
            ? { docs: [{ id: 'r1', name: 'admin' }] }
            : { docs: [{ id: 'u1' }] },
        ),
      ),
    })
    expect(
      await hook({
        collection,
        data: { email: 'c@d.co' },
        operation: 'create',
        req: laterReq,
      } as never),
    ).toEqual({ email: 'c@d.co' })

    // Credential guard, escalation guard, last-admin guard, and first-user
    // assignment on the admin user collection, plus the last-admin delete guard.
    const users = getCollection(result, 'users')
    expect(users.hooks?.beforeChange).toHaveLength(4)
    expect(users.hooks?.beforeDelete).toHaveLength(1)
  })

  it("locks credentials of users holding a credentialChanges: 'self' role to themselves", async () => {
    const result = await rbacPlugin({ adminRole: 'Super Admin' })(baseConfig())
    const hook = createProtectCredentialsHook({
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
      selfOnlyRoleNames: ['Super Admin'],
      userCollectionSlug: 'users',
    })
    const roleDb = () => ({
      find: vi.fn((findArgs: { where?: { id?: { in?: (number | string)[] } } }) => {
        const all = [
          { id: 9, name: 'Super Admin' },
          { id: 3, name: 'Admin' },
        ]
        const ids = findArgs.where?.id?.in
        return Promise.resolve({ docs: ids ? all.filter((r) => ids.includes(r.id)) : all })
      }),
    })
    const clientReq = () => makeReq(result, { id: 2, collection: 'users', roles: [3] }, roleDb())
    const dev = { id: 1, email: 'dev@agency.com', roles: [9] }

    // Another user cannot change the holder's password or email…
    await expect(
      hook({
        data: { password: 'hacked' },
        operation: 'update',
        originalDoc: dev,
        req: clientReq(),
      } as never),
    ).rejects.toThrow(/password-reset email/)
    await expect(
      hook({
        data: { email: 'evil@example.com' },
        operation: 'update',
        originalDoc: dev,
        req: clientReq(),
      } as never),
    ).rejects.toThrow(/email of a user holding .* can only be changed by that user/)

    // …but a full-document save with the email unchanged still passes.
    await expect(
      hook({
        data: { email: 'dev@agency.com' },
        operation: 'update',
        originalDoc: dev,
        req: clientReq(),
      } as never),
    ).resolves.toEqual({ email: 'dev@agency.com' })

    // The account owner changes their own credentials freely.
    await expect(
      hook({
        data: { password: 'new-password' },
        operation: 'update',
        originalDoc: dev,
        req: makeReq(result, { id: 1, collection: 'users', roles: [9] }, roleDb()),
      } as never),
    ).resolves.toBeTruthy()

    // Users without a self-only role stay editable.
    await expect(
      hook({
        data: { password: 'reset-by-admin' },
        operation: 'update',
        originalDoc: { id: 5, roles: [3] },
        req: clientReq(),
      } as never),
    ).resolves.toBeTruthy()

    // Writes not touching credentials never hit the roles lookup.
    const noCredentialWrite = clientReq()
    await expect(
      hook({
        data: { roles: [3] },
        operation: 'update',
        originalDoc: dev,
        req: noCredentialWrite,
      } as never),
    ).resolves.toBeTruthy()
    expect(noCredentialWrite.payload.find).not.toHaveBeenCalled()

    // Creates and system writes (no user) pass through.
    await expect(
      hook({ data: { password: 'x' }, operation: 'create', req: clientReq() } as never),
    ).resolves.toBeTruthy()
    await expect(
      hook({
        data: { password: 'x' },
        operation: 'update',
        originalDoc: dev,
        req: makeReq(result, null, roleDb()),
      } as never),
    ).resolves.toBeTruthy()

    // Wiring: the adminRole always installs the guard; other roles opt in with
    // credentialChanges: 'self'.
    const optIn = await rbacPlugin({
      roles: [{ name: 'Manager', credentialChanges: 'self', permissions: ['posts:read'] }],
    })(baseConfig())
    expect(getCollection(optIn, 'users').hooks?.beforeChange).toHaveLength(2)
    const none = await rbacPlugin({
      roles: [{ name: 'Manager', permissions: ['posts:read'] }],
    })(baseConfig())
    expect(getCollection(none, 'users').hooks?.beforeChange).toHaveLength(1)
  })

  it('keeps at least one user holding the admin role', async () => {
    const result = await rbacPlugin({ adminRole: 'Administrator' })(baseConfig())
    const args = {
      adminRoleName: 'Administrator',
      rolesCollectionSlug: 'roles',
      rolesFieldName: 'roles',
      userCollections: ['users'],
      userCollectionSlug: 'users',
    }
    const changeHook = createProtectLastAdminChangeHook(args)
    const deleteHook = createProtectLastAdminDeleteHook(args)

    // `count` is the number of OTHER users still holding the admin role.
    const reqWithOtherAdmins = (count: number) =>
      makeReq(
        result,
        { id: 1, collection: 'users', roles: [9] },
        {
          count: vi.fn(() => Promise.resolve({ totalDocs: count })),
          find: vi.fn(() => Promise.resolve({ docs: [{ id: 9, name: 'Administrator' }] })),
          findByID: vi.fn(() => Promise.resolve({ id: 1, roles: [9] })),
        },
      )

    // Removing the admin role from the last holder is blocked…
    await expect(
      changeHook({
        data: { roles: [] },
        originalDoc: { id: 1, roles: [9] },
        req: reqWithOtherAdmins(0),
      } as never),
    ).rejects.toThrow(/at least one administrator must remain/)
    // …but allowed while another admin exists, and when the role is kept.
    await expect(
      changeHook({
        data: { roles: [] },
        originalDoc: { id: 1, roles: [9] },
        req: reqWithOtherAdmins(1),
      } as never),
    ).resolves.toEqual({ roles: [] })
    await expect(
      changeHook({
        data: { email: 'a@b.co', roles: [9] },
        originalDoc: { id: 1, roles: [9] },
        req: reqWithOtherAdmins(0),
      } as never),
    ).resolves.toBeTruthy()

    // Deleting the last admin is blocked; fine while another admin exists.
    await expect(deleteHook({ id: 1, req: reqWithOtherAdmins(0) } as never)).rejects.toThrow(
      /at least one administrator must remain/,
    )
    await expect(deleteHook({ id: 1, req: reqWithOtherAdmins(1) } as never)).resolves.toBe(
      undefined,
    )

    // System writes (no user) bypass the guard.
    await expect(
      changeHook({
        data: { roles: [] },
        originalDoc: { id: 1, roles: [9] },
        req: makeReq(result, null),
      } as never),
    ).resolves.toEqual({ roles: [] })
  })

  it('seeds predefined roles that are missing and never overwrites existing ones', async () => {
    const create = vi.fn()
    const find = vi
      .fn()
      .mockResolvedValueOnce({ docs: [{ id: 1, name: 'admin' }] })
      .mockResolvedValueOnce({ docs: [] })
    const payload = {
      create,
      db: { name: 'postgres' },
      find,
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await seedPredefinedRoles(payload, {
      roles: [
        { name: 'admin', permissions: ['*'] },
        { name: 'editor', description: 'Editors', permissions: ['posts:read'] },
      ],
      rolesCollectionSlug: 'roles',
    })

    expect(create).toHaveBeenCalledTimes(1)
    // Writes run without a transaction so a fresh replica-set boot can't abort on
    // WriteConflict (112) / OperationNotSupportedInTransaction (263).
    expect(create).toHaveBeenCalledWith({
      collection: 'roles',
      data: { name: 'editor', description: 'Editors', permissions: ['posts:read'] },
      disableTransaction: true,
    })
  })

  it('treats an adapter-wrapped unique violation as already-seeded (Mongo ValidationError)', async () => {
    // Payload's mongoose adapter rewraps Mongo's duplicate-key (11000) into a
    // ValidationError that drops the `code`, so `isUniqueViolation` cannot see the
    // race. Seeding must instead confirm the role now exists and move on — without
    // this, every concurrent boot but the winner crashes `onInit`.
    const validationError = Object.assign(new Error('The following field is invalid: name'), {
      name: 'ValidationError',
      data: { collection: 'roles', errors: [{ message: 'Value must be unique', path: 'name' }] },
      status: 400,
    })
    const create = vi.fn(() => Promise.reject(validationError))
    const find = vi
      .fn()
      .mockResolvedValueOnce({ docs: [] }) // initial check: not present yet
      .mockResolvedValueOnce({ docs: [{ id: 'x', name: 'admin' }] }) // re-check: another boot won
    const payload = {
      create,
      db: { name: 'mongoose' },
      find,
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await expect(
      seedPredefinedRoles(payload, {
        roles: [{ name: 'admin', permissions: ['*'] }],
        rolesCollectionSlug: 'roles',
      }),
    ).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledTimes(2) // initial check + post-failure re-check
  })

  it('rethrows a seed create failure when the role still does not exist', async () => {
    // A real create failure (not a lost race) must still surface: the re-check
    // finds no role, so the error propagates instead of being swallowed.
    const boom = Object.assign(new Error('The following field is invalid: name'), {
      name: 'ValidationError',
      status: 400,
    })
    const create = vi.fn(() => Promise.reject(boom))
    const find = vi.fn(() => Promise.resolve({ docs: [] }))
    const payload = {
      create,
      db: { name: 'mongoose' },
      find,
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await expect(
      seedPredefinedRoles(payload, {
        roles: [{ name: 'admin', permissions: ['*'] }],
        rolesCollectionSlug: 'roles',
      }),
    ).rejects.toBe(boom)
  })

  it('runs seeding before the original onInit', async () => {
    const order: string[] = []
    const config = baseConfig()
    config.onInit = () => {
      order.push('original')
    }
    const result = await rbacPlugin({ roles: [{ name: 'admin', permissions: ['*'] }] })(config)

    const payload = {
      create: vi.fn(() => {
        order.push('seed')
        return Promise.resolve({})
      }),
      db: { name: 'postgres' },
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload
    await result.onInit?.(payload)

    expect(order).toEqual(['seed', 'original'])
  })

  it('rejects invalid plugin configuration early', () => {
    expect(() =>
      rbacPlugin({ roles: [{ name: 'admin', permissions: ['nonexistent:read'] }] })(baseConfig()),
    ).toThrow(/unknown permission "nonexistent:read"/)

    // The adminRole is owned by the plugin and cannot also be predefined.
    expect(() =>
      rbacPlugin({
        adminRole: 'admin',
        roles: [{ name: 'admin', permissions: ['posts:read'] }],
      })(baseConfig()),
    ).toThrow(/is the adminRole/)

    const config = baseConfig()
    config.collections?.push({ slug: 'roles', fields: [] })
    expect(() => rbacPlugin()(config)).toThrow(/already exists/)
  })

  it('permission helpers match exact grants and full access', async () => {
    expect(permissionsGrant(new Set(['posts:read']), 'posts', 'read')).toBe(true)
    expect(permissionsGrant(new Set(['posts:read']), 'posts', 'update')).toBe(false)
    expect(permissionsGrant(new Set(['*']), 'anything', 'delete')).toBe(true)

    expect(missingPermissions(new Set(['*']), ['posts:read', '*'])).toEqual([])
    expect(missingPermissions(new Set(['posts:read']), ['posts:read', 'tags:read'])).toEqual([
      'tags:read',
    ])

    const result = await rbacPlugin()(baseConfig())
    const access = createRbacAccess({ slug: 'posts', action: 'read' })
    expect(
      await access({ req: makeReq(result, { id: 1, roles: [role(1, ['posts:read'])] }) } as never),
    ).toBe(true)
  })

  it('grants and covers wildcard permissions', async () => {
    // '<slug>:*' — every action on one entity; '*:<action>' — one action everywhere.
    expect(permissionsGrant(new Set(['posts:*']), 'posts', 'delete')).toBe(true)
    expect(permissionsGrant(new Set(['posts:*']), 'pages', 'read')).toBe(false)
    expect(permissionsGrant(new Set(['*:read']), 'anything', 'read')).toBe(true)
    expect(permissionsGrant(new Set(['*:read']), 'posts', 'update')).toBe(false)

    // Escalation coverage: wildcards cover their exact permissions, and holding
    // every action on an entity covers its '<slug>:*' — but '*:<action>' spans
    // future entities, so only itself or full access covers it.
    expect(missingPermissions(new Set(['posts:*']), ['posts:read', 'posts:delete'])).toEqual([])
    expect(missingPermissions(new Set(['*:read']), ['posts:read', 'tags:read'])).toEqual([])
    expect(
      missingPermissions(new Set(['posts:create', 'posts:delete', 'posts:read', 'posts:update']), [
        'posts:*',
      ]),
    ).toEqual([])
    expect(missingPermissions(new Set(['posts:read', 'tags:read']), ['*:read'])).toEqual(['*:read'])
    expect(permissionCovers(new Set(['pages:*']), 'pages:read')).toBe(true)
    expect(permissionCovers(new Set(['pages:read']), 'pages:*')).toBe(false)

    // '*:<action>' for all four actions is equivalent to '*' and counts as full access.
    const everyActionWildcard = ['*:create', '*:read', '*:update', '*:delete']
    expect(fullAccessPermissions(new Set(everyActionWildcard))).toBe(true)
    expect(fullAccessPermissions(new Set(['*:read', '*:update']))).toBe(false)
    expect(missingPermissions(new Set(everyActionWildcard), ['*', 'posts:*', 'tags:read'])).toEqual(
      [],
    )
    const payload = {
      find: vi.fn(() =>
        Promise.resolve({
          docs: [
            { id: 1, permissions: ['*'] },
            { id: 2, permissions: everyActionWildcard },
            { id: 3, permissions: ['posts:*', '*:read'] },
          ],
        }),
      ),
    } as unknown as Payload
    expect(await findFullAccessRoleIds(payload, 'roles')).toEqual([1, 2])
  })

  it('accepts wildcard permissions in predefined roles, options, and access control', async () => {
    const result = await rbacPlugin({
      roles: [{ name: 'Editor', permissions: ['posts:*', '*:read'] }],
    })(baseConfig())

    const roles = getCollection(result, 'roles')
    const permissionsField = roles.fields.find(
      (f) => 'name' in f && f.name === 'permissions',
    ) as SelectField
    const values = permissionsField.options.map((o) => (typeof o === 'string' ? o : o.value))
    expect(values).toEqual(
      expect.arrayContaining(['posts:*', 'site-settings:*', '*:read', '*:delete']),
    )
    expect(values).not.toContain('*:*')

    const read = createRbacAccess({ slug: 'site-settings', action: 'read' })
    const update = createRbacAccess({ slug: 'site-settings', action: 'update' })
    const wildcardReader = { id: 1, roles: [role(1, ['*:read'])] }
    expect(await read({ req: makeReq(result, wildcardReader) } as never)).toBe(true)
    expect(await update({ req: makeReq(result, wildcardReader) } as never)).toBe(false)

    const req = makeReq(result, { id: 2, roles: [role(2, ['posts:*'])] })
    const postsDelete = createRbacAccess({ slug: 'posts', action: 'delete' })
    expect(await postsDelete({ req } as never)).toBe(true)

    // Unknown slugs and actions still fail fast at startup.
    expect(() =>
      rbacPlugin({ roles: [{ name: 'X', permissions: ['nonexistent:*'] }] })(baseConfig()),
    ).toThrow(/unknown permission "nonexistent:\*"/)
    expect(() =>
      rbacPlugin({ roles: [{ name: 'X', permissions: ['*:publish'] }] })(baseConfig()),
    ).toThrow(/unknown permission "\*:publish"/)
  })

  it('skips the runtime index build on non-mongoose adapters', async () => {
    const createIndexes = vi.fn(() => Promise.resolve())
    const payload = {
      db: { name: 'postgres', collections: { roles: { createIndexes } } },
      logger: { error: vi.fn() },
    } as unknown as Payload

    await ensureRolesIndexes(payload, 'roles')
    expect(createIndexes).not.toHaveBeenCalled()
  })

  it('builds the roles indexes on mongoose before seeding', async () => {
    const createIndexes = vi.fn(() => Promise.resolve())
    const payload = {
      db: { name: 'mongoose', collections: { roles: { createIndexes } } },
      logger: { error: vi.fn() },
    } as unknown as Payload

    await ensureRolesIndexes(payload, 'roles')
    expect(createIndexes).toHaveBeenCalledTimes(1)
  })

  it('logs (does not throw) when existing duplicates block the unique index build', async () => {
    const error = vi.fn()
    const duplicateKey = Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    const payload = {
      db: {
        name: 'mongoose',
        collections: { roles: { createIndexes: () => Promise.reject(duplicateKey) } },
      },
      logger: { error },
    } as unknown as Payload

    await expect(ensureRolesIndexes(payload, 'roles')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('rethrows index build errors that are not unique violations', async () => {
    const boom = new Error('disk full')
    const payload = {
      db: {
        name: 'mongoose',
        collections: { roles: { createIndexes: () => Promise.reject(boom) } },
      },
      logger: { error: vi.fn() },
    } as unknown as Payload

    await expect(ensureRolesIndexes(payload, 'roles')).rejects.toBe(boom)
  })

  it('calls createIndexes bound to its model (mongoose needs `this`)', async () => {
    // Mongoose's real `Model.createIndexes()` throws when invoked without the
    // model as `this` ("cannot run without a model as `this`"). A bare mock
    // would not catch a lost binding, so this model asserts its own identity.
    const rolesModel: { createIndexes: () => Promise<void> } = {
      createIndexes(this: unknown) {
        if (this !== rolesModel) {
          return Promise.reject(
            new Error('`Model.createIndexes()` cannot run without a model as `this`'),
          )
        }
        return Promise.resolve()
      },
    }
    const payload = {
      db: { name: 'mongoose', collections: { roles: rolesModel } },
      logger: { error: vi.fn() },
    } as unknown as Payload

    await expect(ensureRolesIndexes(payload, 'roles')).resolves.toBeUndefined()
  })

  it('retries a WriteConflict while building the roles indexes', async () => {
    const writeConflict = Object.assign(new Error('WriteConflict'), {
      code: 112,
      codeName: 'WriteConflict',
    })
    const createIndexes = vi
      .fn()
      .mockRejectedValueOnce(writeConflict)
      .mockResolvedValueOnce(undefined)
    const payload = {
      db: { name: 'mongoose', collections: { roles: { createIndexes } } },
      logger: { error: vi.fn() },
    } as unknown as Payload

    await expect(ensureRolesIndexes(payload, 'roles')).resolves.toBeUndefined()
    expect(createIndexes).toHaveBeenCalledTimes(2)
  })

  it('retries a transient write-concern error while building the roles indexes', async () => {
    // Concurrent `onInit` boots hammering a fresh replica set can knock the
    // index build over with a `MongoWriteConcernError: operation was
    // interrupted` — not a WriteConflict, so it must still be retried.
    const writeConcern = Object.assign(new Error('operation was interrupted'), {
      name: 'MongoWriteConcernError',
      writeConcernError: { code: 11602, errmsg: 'operation was interrupted' },
    })
    const createIndexes = vi
      .fn()
      .mockRejectedValueOnce(writeConcern)
      .mockResolvedValueOnce(undefined)
    const payload = {
      db: { name: 'mongoose', collections: { roles: { createIndexes } } },
      logger: { error: vi.fn() },
    } as unknown as Payload

    await expect(ensureRolesIndexes(payload, 'roles')).resolves.toBeUndefined()
    expect(createIndexes).toHaveBeenCalledTimes(2)
  })

  it('treats a unique violation during seed create as already-seeded (concurrent boot)', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' })
    const create = vi.fn(() => Promise.reject(uniqueViolation))
    const payload = {
      create,
      db: { name: 'postgres' },
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await expect(
      seedPredefinedRoles(payload, {
        roles: [{ name: 'admin', permissions: ['*'] }],
        rolesCollectionSlug: 'roles',
      }),
    ).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-unique create errors during seed', async () => {
    const boom = new Error('connection refused')
    const payload = {
      create: vi.fn(() => Promise.reject(boom)),
      db: { name: 'postgres' },
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await expect(
      seedPredefinedRoles(payload, {
        roles: [{ name: 'admin', permissions: ['*'] }],
        rolesCollectionSlug: 'roles',
      }),
    ).rejects.toBe(boom)
  })

  it('retries a WriteConflict during seed create instead of failing init', async () => {
    // A write against a fresh collection whose index is still building can be
    // aborted with a transient WriteConflict (code 112) — which is NOT a unique
    // violation, so without the retry it would propagate out of `onInit` and fail
    // the build ("payloadInitError: true").
    const writeConflict = Object.assign(new Error('WriteConflict'), {
      code: 112,
      codeName: 'WriteConflict',
    })
    const create = vi.fn().mockRejectedValueOnce(writeConflict).mockResolvedValueOnce({})
    const payload = {
      create,
      db: { name: 'mongoose' },
      find: vi.fn(() => Promise.resolve({ docs: [] })),
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await expect(
      seedPredefinedRoles(payload, {
        roles: [{ name: 'admin', permissions: ['*'] }],
        rolesCollectionSlug: 'roles',
      }),
    ).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('detects unique-constraint violations across adapters (including wrapped causes)', () => {
    expect(isUniqueViolation({ code: 11000 })).toBe(true) // MongoDB
    expect(isUniqueViolation({ code: '23505' })).toBe(true) // Postgres
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true) // SQLite
    expect(isUniqueViolation({ cause: { code: 11000 } })).toBe(true) // Drizzle-wrapped
    expect(isUniqueViolation({ code: 'ETIMEDOUT' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })

  it('detects transient WriteConflict errors but not unique violations', () => {
    expect(isWriteConflict({ code: 112 })).toBe(true)
    expect(isWriteConflict({ codeName: 'WriteConflict' })).toBe(true)
    expect(
      isWriteConflict(Object.assign(new Error('x'), { code: 112, payloadInitError: true })),
    ).toBe(true)
    expect(isWriteConflict({ cause: { codeName: 'WriteConflict' } })).toBe(true) // wrapped
    // A unique violation is a permanent "already seeded" signal, not a conflict.
    expect(isWriteConflict({ code: 11000 })).toBe(false)
    expect(isWriteConflict(new Error('boom'))).toBe(false)
    expect(isWriteConflict(null)).toBe(false)
  })

  it('detects the broader transient-error class but not permanent failures', () => {
    // Superset of WriteConflict.
    expect(isTransientMongoError({ code: 112 })).toBe(true)
    expect(isTransientMongoError({ codeName: 'WriteConflict' })).toBe(true)
    // Write-concern / replica-set churn that concurrent boots provoke.
    expect(isTransientMongoError({ name: 'MongoWriteConcernError' })).toBe(true)
    expect(isTransientMongoError({ writeConcernError: { code: 11602 } })).toBe(true)
    expect(isTransientMongoError({ codeName: 'InterruptedDueToReplStateChange' })).toBe(true)
    expect(isTransientMongoError({ errorLabels: ['RetryableWriteError'] })).toBe(true)
    expect(isTransientMongoError({ cause: { name: 'MongoWriteConcernError' } })).toBe(true) // wrapped
    // Permanent failures must NOT be retried.
    expect(isTransientMongoError({ code: 11000 })).toBe(false) // duplicate key
    expect(isTransientMongoError(new Error('disk full'))).toBe(false)
    expect(isTransientMongoError(null)).toBe(false)
  })

  it('retries write conflicts and rethrows every other error', async () => {
    const conflict = Object.assign(new Error('WriteConflict'), {
      code: 112,
      codeName: 'WriteConflict',
    })

    // Succeeds once the conflict clears.
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce('ok')
    await expect(retryOnWriteConflict(flaky, { delayMs: 0 })).resolves.toBe('ok')
    expect(flaky).toHaveBeenCalledTimes(3)

    // Gives up after exhausting the retries, rethrowing the last conflict rather
    // than swallowing it, so a genuinely stuck write still surfaces.
    const stuck = vi.fn().mockRejectedValue(conflict)
    await expect(retryOnWriteConflict(stuck, { delayMs: 0, retries: 2 })).rejects.toBe(conflict)
    expect(stuck).toHaveBeenCalledTimes(3) // 1 initial attempt + 2 retries

    // Non-conflict errors are thrown immediately, never retried.
    const boom = new Error('connection refused')
    const failing = vi.fn().mockRejectedValue(boom)
    await expect(retryOnWriteConflict(failing, { delayMs: 0 })).rejects.toBe(boom)
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

import type { Access, CollectionConfig, PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import type { Env } from '../src/types.js'

import { addAccessSettingsToUploadCollection } from '../src/lib/collectionConfig.js'

interface StoredDocument {
  createdDuringDevelopment?: boolean
  id: number
}

const makeCollection = ({
  documents,
  env,
  ownAccess,
}: {
  documents: StoredDocument[]
  env: Env
  ownAccess?: CollectionConfig['access']
}) => {
  const queries: { id: { in: string[] } }[] = []

  const collection = addAccessSettingsToUploadCollection(
    {
      slug: 'privateMedia',
      access: ownAccess,
      fields: [],
      upload: true,
    },
    () => Promise.resolve(env),
  )

  const makeRequest = (search: string, method?: string) =>
    ({
      method,
      payload: {
        find: ({ where }: { where: { id: { in: string[] } } }) => {
          queries.push(where)
          const ids = where.id.in.map(String)
          return Promise.resolve({ docs: documents.filter((doc) => ids.includes(String(doc.id))) })
        },
      },
      searchParams: new URLSearchParams(search),
    }) as unknown as PayloadRequest

  const call = (
    operation: 'delete' | 'update',
    args: { data?: Record<string, unknown>; id?: number; method?: string; search?: string },
  ) =>
    (collection.access![operation] as Access)({
      id: args.id,
      data: args.data,
      req: makeRequest(args.search ?? '', args.method),
    } as Parameters<Access>[0])

  return { call, queries }
}

const devCreated: StoredDocument[] = [{ id: 12095, createdDuringDevelopment: true }]
const productionCopied: StoredDocument[] = [{ id: 12095, createdDuringDevelopment: false }]

describe('addAccessSettingsToUploadCollection', () => {
  describe('in development', () => {
    // The regression: with `trash` enabled the admin's delete button sends
    // `PATCH { deletedAt }` and nothing else, so the flag is absent from `data`
    // even though the stored document carries it.
    it('allows a trash soft-delete of a development-created document', async () => {
      const { call } = makeCollection({ documents: devCreated, env: 'development' })

      await expect(
        call('update', { id: 12095, data: { deletedAt: '2026-08-10T00:00:00.000Z' } }),
      ).resolves.toBe(true)
    })

    it('allows a bulk trash soft-delete selected by a nested where clause', async () => {
      const { call } = makeCollection({ documents: devCreated, env: 'development' })

      await expect(
        call('update', {
          data: { deletedAt: '2026-08-10T00:00:00.000Z' },
          search: 'where[and][0][id][in][0]=12095&trash=true',
        }),
      ).resolves.toBe(true)
    })

    it('refuses a write against a document copied from production', async () => {
      const { call } = makeCollection({ documents: productionCopied, env: 'development' })

      await expect(
        call('update', {
          id: 12095,
          data: { deletedAt: '2026-08-10T00:00:00.000Z' },
          method: 'PATCH',
        }),
      ).rejects.toThrow(/not created during development/)
      await expect(call('delete', { id: 12095, method: 'DELETE' })).rejects.toThrow(
        /not created during development/,
      )
    })

    // The 1.4.5 regression: the admin's document view evaluates the same access
    // function purely to build its permissions object, and it always identifies
    // the document by id. Throwing there left the view with no permissions at
    // all, so every production-copied upload rendered as "Nothing found" instead
    // of opening read-only.
    it('answers false, without throwing, to the admin’s permission probe on a production-copied document', async () => {
      const { call } = makeCollection({ documents: productionCopied, env: 'development' })
      const storedDocument = { id: 12095, _status: 'draft', createdDuringDevelopment: false }

      await expect(call('update', { id: 12095, data: storedDocument })).resolves.toBe(false)
      await expect(call('delete', { id: 12095, data: storedDocument })).resolves.toBe(false)
    })

    it('answers false to a REST access probe (GET /access/:id) on a production-copied document', async () => {
      const { call } = makeCollection({ documents: productionCopied, env: 'development' })

      await expect(call('update', { id: 12095, method: 'GET' })).resolves.toBe(false)
      await expect(call('delete', { id: 12095, method: 'GET' })).resolves.toBe(false)
    })

    it('reserves the public 403 explanation for requests that actually mutate', async () => {
      const { call } = makeCollection({ documents: productionCopied, env: 'development' })

      await expect(
        call('update', { id: 12095, data: { alt: 'renamed' }, method: 'PATCH' }),
      ).rejects.toMatchObject({ isPublic: true, status: 403 })
      await expect(call('delete', { id: 12095, method: 'DELETE' })).rejects.toMatchObject({
        isPublic: true,
        status: 403,
      })
    })

    it('reads the stored flag rather than trusting the incoming data', async () => {
      const { call } = makeCollection({ documents: productionCopied, env: 'development' })

      await expect(
        call('update', { id: 12095, data: { createdDuringDevelopment: true }, method: 'PATCH' }),
      ).rejects.toThrow(/not created during development/)
    })

    it('ignores query params whose field name merely contains "id"', async () => {
      const { call, queries } = makeCollection({ documents: devCreated, env: 'development' })

      await expect(
        call('update', {
          id: 12095,
          data: { deletedAt: '2026-08-10T00:00:00.000Z' },
          search: 'where[videoId][equals]=abc&depth=0',
        }),
      ).resolves.toBe(true)
      expect(queries).toEqual([{ id: { in: ['12095'] } }])
    })

    it('falls back to the incoming data when no document is identified', async () => {
      const { call, queries } = makeCollection({ documents: devCreated, env: 'development' })

      await expect(
        call('update', { data: { deletedAt: '2026-08-10T00:00:00.000Z' } }),
      ).resolves.toBe(false)
      await expect(call('update', { data: { createdDuringDevelopment: true } })).resolves.toBe(true)
      expect(queries).toEqual([])
    })

    it('still defers to the collection’s own access when the guard passes', async () => {
      const { call } = makeCollection({
        documents: devCreated,
        env: 'development',
        ownAccess: { delete: () => false, update: () => false },
      })

      await expect(
        call('update', { id: 12095, data: { deletedAt: '2026-08-10T00:00:00.000Z' } }),
      ).resolves.toBe(false)
    })
  })

  describe('in production', () => {
    it('skips the guard entirely and defers to the collection’s own access', async () => {
      const { call, queries } = makeCollection({ documents: productionCopied, env: 'production' })

      await expect(call('update', { id: 12095, data: { deletedAt: 'x' } })).resolves.toBe(true)
      await expect(call('delete', { id: 12095 })).resolves.toBe(true)
      expect(queries).toEqual([])
    })
  })
})

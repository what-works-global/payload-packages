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

  const makeRequest = (search: string) =>
    ({
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
    args: { data?: Record<string, unknown>; id?: number; search?: string },
  ) =>
    (collection.access![operation] as Access)({
      id: args.id,
      data: args.data,
      req: makeRequest(args.search ?? ''),
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
        call('update', { id: 12095, data: { deletedAt: '2026-08-10T00:00:00.000Z' } }),
      ).rejects.toThrow(/not created during development/)
      await expect(call('delete', { id: 12095 })).rejects.toThrow(/not created during development/)
    })

    it('reads the stored flag rather than trusting the incoming data', async () => {
      const { call } = makeCollection({ documents: productionCopied, env: 'development' })

      await expect(
        call('update', { id: 12095, data: { createdDuringDevelopment: true } }),
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

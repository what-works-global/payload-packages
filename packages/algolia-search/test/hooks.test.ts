import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncAfterChange, syncAfterDelete } from '../src/index.js'
import { makeClient, pagesCollection, tagsCollection, withClient } from './helpers.js'

type ChangeArgs = Parameters<CollectionAfterChangeHook>[0]
type DeleteArgs = Parameters<CollectionAfterDeleteHook>[0]

const makeReq = (findByID: ReturnType<typeof vi.fn> = vi.fn()) =>
  ({
    payload: {
      findByID,
      logger: { error: vi.fn() },
    },
  }) as unknown as ChangeArgs['req']

const change = (args: {
  collection?: typeof pagesCollection
  doc: Record<string, unknown>
  findByID?: ReturnType<typeof vi.fn>
  previousDoc?: Record<string, unknown>
}) =>
  ({
    collection: args.collection ?? pagesCollection,
    doc: args.doc,
    previousDoc: args.previousDoc,
    req: makeReq(args.findByID),
  }) as unknown as ChangeArgs

describe('syncAfterChange draft matrix', () => {
  it('ignores the first draft of a never-published doc', async () => {
    const client = makeClient()
    await syncAfterChange(withClient(client))(
      change({ doc: { id: 1, _status: 'draft', title: 'Draft' } }),
    )
    expect(client.saveObject).not.toHaveBeenCalled()
    expect(client.deleteObject).not.toHaveBeenCalled()
  })

  it('ignores draft saves (autosave) on top of a published doc', async () => {
    const client = makeClient()
    const findByID = vi.fn(() => Promise.resolve({ id: 1, _status: 'published' }))
    await syncAfterChange(withClient(client))(
      change({
        doc: { id: 1, _status: 'draft', title: 'Pending change' },
        findByID,
        previousDoc: { id: 1 },
      }),
    )
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, collection: 'pages', draft: false }),
    )
    expect(client.saveObject).not.toHaveBeenCalled()
    expect(client.deleteObject).not.toHaveBeenCalled()
  })

  it('removes the record when the doc is unpublished', async () => {
    const client = makeClient()
    const findByID = vi.fn(() => Promise.resolve({ id: 1, _status: 'draft' }))
    await syncAfterChange(withClient(client))(
      change({
        doc: { id: 1, _status: 'draft', title: 'Unpublished' },
        findByID,
        previousDoc: { id: 1 },
      }),
    )
    expect(client.deleteObject).toHaveBeenCalledWith({
      indexName: 'test-index',
      objectID: 'pages:1',
    })
  })

  it('removes the record when no published version exists (findByID throws)', async () => {
    const client = makeClient()
    const findByID = vi.fn(() => Promise.reject(new Error('NotFound')))
    await syncAfterChange(withClient(client))(
      change({
        doc: { id: 1, _status: 'draft' },
        findByID,
        previousDoc: { id: 1 },
      }),
    )
    expect(client.deleteObject).toHaveBeenCalled()
  })

  it('indexes on publish with the default record shape', async () => {
    const client = makeClient()
    await syncAfterChange(withClient(client))(
      change({
        doc: {
          id: 1,
          slug: 'hello',
          _status: 'published',
          body: 'Some body',
          title: 'Hello',
        },
        previousDoc: { id: 1 },
      }),
    )
    expect(client.saveObject).toHaveBeenCalledWith({
      body: {
        collection: 'pages',
        content: 'Some body',
        objectID: 'pages:1',
        title: 'Hello',
      },
      indexName: 'test-index',
    })
  })

  it('indexes docs of collections without drafts', async () => {
    const client = makeClient()
    await syncAfterChange(withClient(client, { collections: { tags: {} } }))(
      change({ collection: tagsCollection, doc: { id: 7, name: 'Tag' } }),
    )
    expect(client.saveObject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ objectID: 'tags:7', title: 'Tag' }),
      }),
    )
  })

  it('removes trashed docs (deletedAt)', async () => {
    const client = makeClient()
    await syncAfterChange(withClient(client))(
      change({
        doc: { id: 1, _status: 'published', deletedAt: '2026-01-01' },
        previousDoc: { id: 1 },
      }),
    )
    expect(client.deleteObject).toHaveBeenCalled()
    expect(client.saveObject).not.toHaveBeenCalled()
  })

  it('removes the record when the collection record transform opts the doc out', async () => {
    const client = makeClient()
    const context = withClient(client, {
      collections: { pages: { record: () => null } },
    })
    await syncAfterChange(context)(
      change({ doc: { id: 1, _status: 'published', title: 'Hidden' } }),
    )
    expect(client.deleteObject).toHaveBeenCalled()
    expect(client.saveObject).not.toHaveBeenCalled()
  })

  it('never throws into the save flow: Algolia errors are logged, doc returned', async () => {
    const client = makeClient()
    client.saveObject.mockImplementation(() => Promise.reject(new Error('algolia down')))
    const args = change({ doc: { id: 1, _status: 'published', title: 'X' } })
    const result = await syncAfterChange(withClient(client))(args)
    expect(result).toBe(args.doc)
    expect((args.req.payload.logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('does nothing while unconfigured', async () => {
    const client = makeClient()
    await syncAfterChange(withClient(client, { configured: false }))(
      change({ doc: { id: 1, _status: 'published' } }),
    )
    expect(client.saveObject).not.toHaveBeenCalled()
  })
})

describe('awaitSync: false (background writes)', () => {
  const requestContextSymbol = Symbol.for('@vercel/request-context')
  const globalWithContext = globalThis as Record<symbol, unknown>

  afterEach(() => {
    delete globalWithContext[requestContextSymbol]
  })

  it('hands the write to the Vercel request context waitUntil without blocking the hook', async () => {
    const waitUntil = vi.fn()
    globalWithContext[requestContextSymbol] = { get: () => ({ waitUntil }) }
    const client = makeClient()
    let resolveSave: (value: object) => void = () => {}
    client.saveObject.mockImplementation(
      () =>
        new Promise<object>((resolve) => {
          resolveSave = resolve
        }),
    )
    await syncAfterChange(withClient(client, { awaitSync: false }))(
      change({
        doc: { id: 1, _status: 'published', title: 'Hello' },
        previousDoc: { id: 1 },
      }),
    )
    // the hook returned while the write was still pending — waitUntil owns it now
    expect(waitUntil).toHaveBeenCalledTimes(1)
    resolveSave({})
    await waitUntil.mock.calls[0]?.[0]
  })

  it('waitUntil receives a promise that never rejects — failures are logged instead', async () => {
    const waitUntil = vi.fn()
    globalWithContext[requestContextSymbol] = { get: () => ({ waitUntil }) }
    const client = makeClient()
    client.saveObject.mockImplementation(() => Promise.reject(new Error('algolia down')))
    const args = change({
      doc: { id: 1, _status: 'published', title: 'X' },
      previousDoc: { id: 1 },
    })
    await syncAfterChange(withClient(client, { awaitSync: false }))(args)
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined()
    expect((args.req.payload.logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('prefers a config-provided waitUntil over the Vercel context', async () => {
    const vercelWaitUntil = vi.fn()
    globalWithContext[requestContextSymbol] = { get: () => ({ waitUntil: vercelWaitUntil }) }
    const customWaitUntil = vi.fn()
    const client = makeClient()
    await syncAfterChange(withClient(client, { awaitSync: false, waitUntil: customWaitUntil }))(
      change({
        doc: { id: 1, _status: 'published', title: 'Hello' },
        previousDoc: { id: 1 },
      }),
    )
    expect(customWaitUntil).toHaveBeenCalledTimes(1)
    expect(vercelWaitUntil).not.toHaveBeenCalled()
  })

  it('still writes with no scheduler at all (long-lived servers)', async () => {
    const client = makeClient()
    await syncAfterChange(withClient(client, { awaitSync: false }))(
      change({
        doc: { id: 1, _status: 'published', title: 'Hello' },
        previousDoc: { id: 1 },
      }),
    )
    expect(client.saveObject).toHaveBeenCalled()
  })

  it('registers delete-hook writes with waitUntil too', async () => {
    const waitUntil = vi.fn()
    globalWithContext[requestContextSymbol] = { get: () => ({ waitUntil }) }
    const client = makeClient()
    await syncAfterDelete(withClient(client, { awaitSync: false }))({
      id: 1,
      collection: pagesCollection,
      doc: { id: 1 },
      req: makeReq(),
    } as unknown as DeleteArgs)
    expect(client.deleteObject).toHaveBeenCalled()
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })
})

describe('syncAfterDelete', () => {
  it('removes the record by id', async () => {
    const client = makeClient()
    await syncAfterDelete(withClient(client))({
      id: 1,
      collection: pagesCollection,
      doc: { id: 1 },
      req: makeReq(),
    } as unknown as DeleteArgs)
    expect(client.deleteObject).toHaveBeenCalledWith({
      indexName: 'test-index',
      objectID: 'pages:1',
    })
  })
})

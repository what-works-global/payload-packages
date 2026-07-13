import type { BasePayload, PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import type { AlgoliaSearchContext } from '../src/index.js'

import { createReindexHandler, pluginKey, runAlgoliaReindex } from '../src/index.js'
import { makeClient, pagesCollection, tagsCollection, withClient } from './helpers.js'

const pagesDocs = [
  { id: 1, slug: 'one', _status: 'published', body: 'First page body', title: 'Page one' },
  { id: 2, slug: 'two', _status: 'published', body: 'Second page body', title: 'Page two' },
]
const tagsDocs = [{ id: 9, name: 'General' }]

const makePayload = (context: AlgoliaSearchContext) => {
  const find = vi.fn(({ collection }: { collection: string }) =>
    Promise.resolve(
      collection === 'pages'
        ? { docs: pagesDocs, hasNextPage: false }
        : { docs: tagsDocs, hasNextPage: false },
    ),
  )
  const payload = {
    collections: {
      pages: { config: pagesCollection },
      tags: { config: tagsCollection },
    },
    config: { custom: { [pluginKey]: context } },
    find,
    logger: { error: vi.fn() },
  } as unknown as BasePayload
  return { find, payload }
}

describe('runAlgoliaReindex', () => {
  it('full reindex: pushes settings, then replaceAllObjects with every record', async () => {
    const client = makeClient()
    const context = withClient(client, { collections: { pages: {}, tags: {} } })
    const { find, payload } = makePayload(context)

    const result = await runAlgoliaReindex(payload)

    expect(client.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ indexName: 'test-index' }),
    )
    // drafts-enabled collections only fetch published docs; others fetch everything
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'pages',
        where: { _status: { equals: 'published' } },
      }),
    )
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'tags', where: undefined }),
    )

    expect(client.replaceAllObjects).toHaveBeenCalledTimes(1)
    const call = client.replaceAllObjects.mock.calls[0][0] as {
      objects: { objectID: string }[]
    }
    expect(call.objects.map((object) => object.objectID)).toEqual(['pages:1', 'pages:2', 'tags:9'])
    expect(result).toEqual({
      indexed: { pages: 2, tags: 1 },
      mode: 'all',
      total: 3,
    })
  })

  it('single collection: deleteBy the collection facet, then saveObjects', async () => {
    const client = makeClient()
    const context = withClient(client, { collections: { pages: {}, tags: {} } })
    const { payload } = makePayload(context)

    const result = await runAlgoliaReindex(payload, { collection: 'pages' })

    expect(client.deleteBy).toHaveBeenCalledWith({
      deleteByParams: { filters: 'collection:"pages"' },
      indexName: 'test-index',
    })
    expect(client.saveObjects).toHaveBeenCalledTimes(1)
    expect(client.replaceAllObjects).not.toHaveBeenCalled()
    expect(result.mode).toBe('collection')
    expect(result.total).toBe(2)
  })

  it('rejects unknown collections and unconfigured credentials', async () => {
    const client = makeClient()
    const { payload } = makePayload(withClient(client))
    await expect(runAlgoliaReindex(payload, { collection: 'nope' })).rejects.toThrow(
      'not configured for search',
    )

    const { payload: unconfigured } = makePayload(withClient(client, { configured: false }))
    await expect(runAlgoliaReindex(unconfigured)).rejects.toThrow('missing Algolia credentials')
  })
})

describe('createReindexHandler', () => {
  const makeHandlerReq = (
    context: AlgoliaSearchContext,
    query: Record<string, unknown>,
    user: unknown,
  ) => {
    const { payload } = makePayload(context)
    return { payload, query, user } as unknown as PayloadRequest
  }

  it('403s when access denies (default: unauthenticated)', async () => {
    const client = makeClient()
    const context = withClient(client)
    const response = await createReindexHandler(context)(makeHandlerReq(context, {}, null))
    expect(response.status).toBe(403)
  })

  it('400s for a collection that is not configured', async () => {
    const client = makeClient()
    const context = withClient(client)
    const response = await createReindexHandler(context)(
      makeHandlerReq(context, { collection: 'unknown' }, { id: 'u1' }),
    )
    expect(response.status).toBe(400)
  })

  it('503s while credentials are missing', async () => {
    const client = makeClient()
    const context = withClient(client, { configured: false })
    const response = await createReindexHandler(context)(makeHandlerReq(context, {}, { id: 'u1' }))
    expect(response.status).toBe(503)
  })

  it('runs the reindex and reports counts', async () => {
    const client = makeClient()
    const context = withClient(client, { collections: { pages: {}, tags: {} } })
    const response = await createReindexHandler(context)(
      makeHandlerReq(context, { collection: 'pages' }, { id: 'u1' }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { indexed: Record<string, number>; success: boolean }
    expect(body.success).toBe(true)
    expect(body.indexed).toEqual({ pages: 2 })
  })
})

import type { PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import type { AlgoliaSearchContext } from '../src/index.js'

import { ReindexActionServer } from '../src/exports/rsc.js'
import { pluginKey } from '../src/index.js'
import { makeContext } from './helpers.js'

// the client component pulls the whole @payloadcms/ui graph (CSS included)
// into Node — the gate under test only cares that it renders with the props
vi.mock('../src/ui/ReindexAction.js', () => ({
  ReindexAction: () => null,
}))

const makeServerReq = (context: AlgoliaSearchContext, user: unknown = { id: 1 }) =>
  ({
    payload: {
      config: { custom: { [pluginKey]: context } },
      logger: { error: vi.fn() },
    },
    user,
  }) as unknown as PayloadRequest

const props = { collections: ['pages'], reindexPath: '/algolia-search/reindex' }

describe('ReindexActionServer (header icon access gate)', () => {
  it('renders the action for users allowed by reindex.access', async () => {
    const element = await ReindexActionServer({ ...props, req: makeServerReq(makeContext()) })
    expect(element).not.toBeNull()
    expect(element?.props).toEqual(props)
  })

  it('renders nothing when reindex.access denies (default: unauthenticated)', async () => {
    const req = makeServerReq(makeContext(), null)
    expect(await ReindexActionServer({ ...props, req })).toBeNull()
  })

  it('renders nothing and logs when reindex.access throws', async () => {
    const context = makeContext()
    context.reindex.access = () => {
      throw new Error('boom')
    }
    const req = makeServerReq(context)
    expect(await ReindexActionServer({ ...props, req })).toBeNull()
    expect(req.payload.logger.error as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without the plugin context or request', async () => {
    const bareReq = { payload: { config: { custom: {} } } } as unknown as PayloadRequest
    expect(await ReindexActionServer({ ...props, req: bareReq })).toBeNull()
    expect(await ReindexActionServer({ ...props })).toBeNull()
  })
})

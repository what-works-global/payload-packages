import type { PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import { openTransaction, waitForTransaction } from '../src/hooks/shared.js'

const request = (transactionID?: unknown): PayloadRequest =>
  ({ transactionID }) as unknown as PayloadRequest

describe('openTransaction', () => {
  it('reports no transaction when the request has none', async () => {
    await expect(openTransaction(request())).resolves.toBeNull()
  })

  it('reports the id once the adapter started one', async () => {
    await expect(openTransaction(request('tx-1'))).resolves.toBe('tx-1')
    await expect(openTransaction(request(7))).resolves.toBe(7)
  })

  it('treats a left-behind beginTransaction promise as no transaction', async () => {
    // Payload assigns `beginTransaction()`'s promise to req.transactionID and only
    // replaces it when the adapter actually started a transaction. Adapters that
    // don't support them leave the settled promise there forever — reading it as an
    // open transaction made every upload wait for a commit that never came.
    const req = request(Promise.resolve(undefined))
    await expect(openTransaction(req)).resolves.toBeNull()
  })

  it('resolves the pending promise before answering', async () => {
    const req = request()
    // Mirrors initTransaction: the promise both resolves *and* writes the id back.
    req.transactionID = Promise.resolve('tx-2').then((id) => {
      req.transactionID = id
      return id
    }) as unknown as string
    await expect(openTransaction(req)).resolves.toBe('tx-2')
  })
})

describe('waitForTransaction', () => {
  it('returns immediately when nothing is pending', async () => {
    const startedAt = Date.now()
    await waitForTransaction(request(Promise.resolve(undefined)), 5_000)
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('waits until the transaction is committed or rolled back', async () => {
    const req = request('tx-3')
    let released = false
    setTimeout(() => {
      released = true
      delete req.transactionID // what commitTransaction and killTransaction both do
    }, 40)

    await waitForTransaction(req, 5_000)
    expect(released).toBe(true)
  })

  it('gives up after the timeout rather than blocking forever', async () => {
    const startedAt = Date.now()
    await waitForTransaction(request('stuck'), 120)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100)
    expect(Date.now() - startedAt).toBeLessThan(3_000)
  })
})

import type { PayloadRequest } from 'payload'

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { requestOrigin, signJobId, verifyJobId } from '../src/core/chain.js'

const req = (over: Partial<{ headers: Record<string, string>; serverURL: string; url: string }>) =>
  ({
    headers: { get: (name: string) => over.headers?.[name] ?? null },
    payload: { config: { serverURL: over.serverURL ?? '' } },
    url: over.url,
  }) as unknown as PayloadRequest

describe('requestOrigin', () => {
  it('reads the host actually served, so previews and custom domains work', () => {
    expect(requestOrigin(req({ url: 'https://preview-abc.vercel.app/api/media' }))).toBe(
      'https://preview-abc.vercel.app',
    )
  })

  it('prefers proxy headers, since behind one req.url is the internal address', () => {
    expect(
      requestOrigin(
        req({
          headers: { 'x-forwarded-host': 'cdn.example.com', 'x-forwarded-proto': 'https' },
          url: 'http://10.0.0.4:3000/api/media',
        }),
      ),
    ).toBe('https://cdn.example.com')
  })

  it('falls back to serverURL when there is no request URL to read', () => {
    // A job run from the CLI. Chaining is inert there, which is correct — a worker
    // has no function timeout to work around.
    expect(requestOrigin(req({ serverURL: 'https://cms.example.com' }))).toBe(
      'https://cms.example.com',
    )
    expect(requestOrigin(req({}))).toBeNull()
  })
})

describe('continue token', () => {
  it('round-trips for the job it was signed for', () => {
    expect(verifyJobId('secret', 42, signJobId('secret', 42))).toBe(true)
    expect(verifyJobId('secret', '42', signJobId('secret', 42))).toBe(true)
  })

  it('rejects another job, another secret, and a missing token', () => {
    expect(verifyJobId('secret', 43, signJobId('secret', 42))).toBe(false)
    expect(verifyJobId('other', 42, signJobId('secret', 42))).toBe(false)
    expect(verifyJobId('secret', 42, undefined)).toBe(false)
    expect(verifyJobId('secret', 42, '')).toBe(false)
  })

  it('is namespaced, so a signature cannot be borrowed from elsewhere', () => {
    const bare = createHmac('sha256', 'secret').update('42').digest('hex')
    expect(verifyJobId('secret', 42, bare)).toBe(false)
  })
})

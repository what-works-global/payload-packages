import type { PayloadRequest } from 'payload'

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { requestOrigin, signJobId, verifyJobId } from '../src/core/chain.js'

const req = (over: {
  cors?: string | string[]
  csrf?: string[]
  headers?: Record<string, string>
  serverURL?: string
  url?: string
}) =>
  ({
    headers: { get: (name: string) => over.headers?.[name] ?? null },
    payload: {
      config: { cors: over.cors, csrf: over.csrf, serverURL: over.serverURL ?? '' },
    },
    url: over.url,
  }) as unknown as PayloadRequest

describe('requestOrigin', () => {
  it('uses the served host when the app has declared it', () => {
    // A preview deployment listed in csrf: the whole reason to prefer the request
    // over a build-time variable.
    expect(
      requestOrigin(
        req({
          csrf: ['https://preview-abc.vercel.app'],
          serverURL: 'https://cms.example.com',
          url: 'https://preview-abc.vercel.app/api/media',
        }),
      ),
    ).toBe('https://preview-abc.vercel.app')
  })

  it('refuses an undeclared host and falls back to serverURL', () => {
    // The origin receives a signed token, and `x-forwarded-host` is client-set, so
    // an attacker must not be able to name where the server posts its own credential.
    expect(
      requestOrigin(
        req({
          headers: { 'x-forwarded-host': 'attacker.example' },
          serverURL: 'https://cms.example.com',
          url: 'https://cms.example.com/api/media',
        }),
      ),
    ).toBe('https://cms.example.com')
  })

  it('does not treat cors: * as permission to send credentials anywhere', () => {
    // `cors: '*'` says who may call the app, not where the app may be told to post.
    expect(
      requestOrigin(
        req({
          cors: '*',
          headers: { 'x-forwarded-host': 'attacker.example' },
          serverURL: 'https://cms.example.com',
        }),
      ),
    ).toBe('https://cms.example.com')
  })

  it('accepts a declared proxy host', () => {
    expect(
      requestOrigin(
        req({
          cors: ['https://cdn.example.com'],
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

  it('expires, so a captured token is not a permanent capability', () => {
    expect(verifyJobId('secret', 42, signJobId('secret', 42, Date.now() + 60_000))).toBe(true)
    expect(verifyJobId('secret', 42, signJobId('secret', 42, Date.now() - 1))).toBe(false)
  })

  it('will not accept a forged expiry', () => {
    const token = signJobId('secret', 42, Date.now() - 1)
    const digest = token.slice(token.indexOf('.') + 1)
    expect(verifyJobId('secret', 42, `${Date.now() + 60_000}.${digest}`)).toBe(false)
  })

  it('is namespaced, so a signature cannot be borrowed from elsewhere', () => {
    const bare = createHmac('sha256', 'secret').update('42').digest('hex')
    expect(verifyJobId('secret', 42, bare)).toBe(false)
  })
})

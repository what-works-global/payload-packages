/**
 * Plumbing for continuing a chunked conversion in a *new* execution context.
 *
 * `jobs.maxRunMs` splits a ladder across several runs, but on a serverless host the
 * follow-up has to arrive as a fresh HTTP request — backgrounding it in place (Next's
 * `after`, say) re-enters the same invocation and the same timeout, which is the
 * thing the split exists to escape. So a chunk queues the next row and posts to the
 * plugin's own continue endpoint, which answers immediately and hands the work to
 * `dispatch` inside that new invocation.
 */

import type { PayloadRequest } from 'payload'

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Origins the app has declared as its own, mirroring Payload's `getRequestOrigin`. */
const trustedOrigins = (config: PayloadRequest['payload']['config']): null | string[] => {
  const origins = new Set<string>()
  if (config.serverURL) {
    origins.add(config.serverURL)
  }
  const { cors, csrf } = config
  if (cors === '*') {
    return null // the app trusts every origin; we still fall back to serverURL below
  }
  if (Array.isArray(cors)) {
    cors.forEach((origin) => origins.add(origin))
  } else if (cors && typeof cors === 'object') {
    if (cors.origins === '*') {
      return null
    }
    if (Array.isArray(cors.origins)) {
      cors.origins.forEach((origin) => origins.add(origin))
    }
  }
  if (Array.isArray(csrf)) {
    csrf.forEach((origin) => origins.add(origin))
  }
  return [...origins]
}

/**
 * Where to send the continue request.
 *
 * The request that queued the work names the host actually being served, which is
 * what makes preview deployments and custom domains come out right where a
 * build-time variable would not. But the host comes from headers a client controls,
 * and this origin receives a signed token — so it is only used when the app has
 * declared it as its own, via `serverURL`, `cors` or `csrf`. Anything else falls
 * back to `serverURL`, exactly as Payload's own `getRequestOrigin` does.
 */
export const requestOrigin = (req: PayloadRequest): null | string => {
  const config = req.payload.config
  const serverURL = config.serverURL || null

  let candidate: null | string = null
  const forwarded = req.headers?.get('x-forwarded-host')
  if (forwarded) {
    candidate = `${req.headers?.get('x-forwarded-proto') ?? 'https'}://${forwarded}`
  } else {
    try {
      candidate = new URL(req.url ?? '').origin
    } catch {
      // A job run from the CLI has no request to speak of. Chaining is inert there,
      // which is correct: a worker has no function timeout to work around.
      candidate = null
    }
  }
  if (candidate === null) {
    return serverURL
  }

  const trusted = trustedOrigins(config)
  if (trusted === null) {
    // `cors: '*'` is about who may *call* the app, not about where the app may be
    // told to send its own credentials. Only a declared serverURL is good enough.
    return serverURL
  }
  return trusted.includes(candidate) ? candidate : serverURL
}

/**
 * The continue endpoint runs jobs, so it needs its own guard — Payload's
 * `jobs.access.run` never sees it, and that defaults to open anyway. Signing with
 * the app secret means no configuration and nothing new to leak.
 */
/** A continue token is only useful for the moments after it is minted. */
export const CHAIN_TOKEN_TTL_MS = 10 * 60 * 1000

export const signJobId = (
  secret: string,
  jobId: number | string,
  expiresAt: number = Date.now() + CHAIN_TOKEN_TTL_MS,
): string => {
  const message = `video-optimizer:${String(jobId)}:${expiresAt}`
  const digest = createHmac('sha256', secret).update(message).digest('hex')
  return `${expiresAt}.${digest}`
}

/**
 * Rejects a token for another job, another secret, a different scheme, or one that
 * has expired — so a token captured in a log or a proxy is not a permanent capability.
 */
export const verifyJobId = (secret: string, jobId: number | string, token: unknown): boolean => {
  if (typeof token !== 'string') {
    return false
  }
  const separator = token.indexOf('.')
  const expiresAt = Number(token.slice(0, separator))
  if (separator === -1 || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false
  }
  const expected = Buffer.from(signJobId(secret, jobId, expiresAt))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

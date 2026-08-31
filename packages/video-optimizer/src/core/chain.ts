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

/**
 * Where to send the continue request.
 *
 * Taken from the request that queued the work rather than from configuration,
 * because that is the host actually being served — preview deployments and custom
 * domains come out right by construction, where a build-time environment variable
 * would not. Proxy headers win, since behind one `req.url` is the internal address.
 */
export const requestOrigin = (req: PayloadRequest): null | string => {
  const host = req.headers?.get('x-forwarded-host')
  if (host) {
    return `${req.headers?.get('x-forwarded-proto') ?? 'https'}://${host}`
  }
  try {
    return new URL(req.url ?? '').origin
  } catch {
    // A job run from the CLI has no request to speak of. Chaining is inert there,
    // which is correct: a worker has no function timeout to work around.
    return req.payload.config.serverURL || null
  }
}

/**
 * The continue endpoint runs jobs, so it needs its own guard — Payload's
 * `jobs.access.run` never sees it, and that defaults to open anyway. Signing with
 * the app secret means no configuration and nothing new to leak.
 */
export const signJobId = (secret: string, jobId: number | string): string =>
  createHmac('sha256', secret)
    .update(`video-optimizer:${String(jobId)}`)
    .digest('hex')

export const verifyJobId = (secret: string, jobId: number | string, token: unknown): boolean => {
  if (typeof token !== 'string') {
    return false
  }
  const expected = Buffer.from(signJobId(secret, jobId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

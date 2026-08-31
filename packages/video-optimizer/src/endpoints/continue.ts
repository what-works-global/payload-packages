import type { Endpoint, JsonObject } from 'payload'

import type { QueueHookOptions } from '../hooks/stampAndQueue.js'

import { verifyJobId } from '../core/chain.js'

const json = (status: number, body: JsonObject): Response => Response.json(body, { status })

/**
 * `POST /<taskSlug>/continue` `{ jobId, token }` — runs the next chunk of a
 * conversion split by `jobs.maxRunMs`.
 *
 * The whole point is the invocation, not the endpoint: arriving as a fresh HTTP
 * request is what buys a fresh function with a fresh timeout. So this answers `202`
 * *before* doing any work and hands the run to `dispatch`, which is why the caller
 * can safely await it — a blocking endpoint would re-serialise the chain it exists
 * to spread out, and fire-and-forget would race the platform freezing the caller.
 *
 * Guarded by an HMAC of the job id rather than by `jobs.access.run`, which never
 * sees this route and defaults to open in any case.
 */
export const createContinueEndpoint = ({ dispatch, taskSlug }: QueueHookOptions): Endpoint => ({
  handler: async (req) => {
    let body: JsonObject
    try {
      body = ((await req.json?.()) ?? {}) as JsonObject
    } catch {
      return json(400, { error: 'invalid JSON body' })
    }

    const jobId = body.jobId
    if (typeof jobId !== 'string' && typeof jobId !== 'number') {
      return json(400, { error: '`jobId` is required' })
    }
    if (!verifyJobId(req.payload.secret, jobId, body.token)) {
      return json(401, { error: 'invalid token' })
    }

    // Read the descriptor from the row rather than the body: the token authorises
    // running this job, and nothing else in the request needs to be trusted.
    let input: JsonObject
    try {
      const row = (await req.payload.findByID({
        id: jobId,
        collection: 'payload-jobs' as never,
        depth: 0,
        overrideAccess: true,
      })) as JsonObject
      input = (row.input ?? {}) as JsonObject
    } catch {
      // Already collected, or never existed. Cron settles anything still runnable.
      return json(404, { error: 'job not found' })
    }

    const run = async (): Promise<void> => {
      try {
        await req.payload.jobs.runByID({ id: jobId })
      } catch (error) {
        req.payload.logger.warn(
          `[payload-video-optimizer] continued conversion run failed for job ${String(jobId)}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (dispatch) {
      await dispatch(
        {
          collection: String(input.collection ?? ''),
          docId: (input.docId ?? '') as number | string,
          generation: Number(input.generation ?? 0),
          jobId,
          origin: typeof input.origin === 'string' ? input.origin : null,
          sourceFilename: String(input.sourceFilename ?? ''),
        },
        { req, run },
      )
    } else {
      // No dispatch: this request *is* the fresh context, so running inline is
      // correct — it just makes the caller's await last as long as the chunk.
      await run()
    }

    return json(202, { queued: true })
  },
  method: 'post',
  path: `/${taskSlug}/continue`,
})

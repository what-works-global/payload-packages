import type { Endpoint, JsonObject } from 'payload'

import type { QueueHookOptions } from '../hooks/stampAndQueue.js'

import { verifyJobId } from '../core/chain.js'

const json = (status: number, body: JsonObject): Response => Response.json(body, { status })

/**
 * `POST /<taskSlug>/continue` `{ jobId, token }` — runs the next chunk of a
 * conversion split by `jobs.maxRunMs`.
 *
 * The whole point is the invocation, not the endpoint: arriving as a fresh HTTP
 * request is what buys a fresh function with a fresh timeout. So this never blocks —
 * it hands the run to `dispatch` and answers `202` immediately, which is why the
 * caller can safely await it. A blocking endpoint would re-serialise the chain it
 * exists to spread out, and fire-and-forget would race the platform freezing the
 * caller mid-connection.
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
    let row: JsonObject
    try {
      row = (await req.payload.findByID({
        id: jobId,
        collection: 'payload-jobs' as never,
        depth: 0,
        overrideAccess: true,
      })) as JsonObject
    } catch {
      // Already collected, or never existed. Cron settles anything still runnable.
      return json(404, { error: 'job not found' })
    }

    // `runByID` has no state guards of its own — unlike the batch path it does not
    // filter on `completedAt`/`hasError`/`processing`, it just flips `processing`
    // and runs. So a replayed token would re-run finished work, or pile onto a run
    // already in flight. And a token is only ever a licence to continue *our* task.
    if (row.taskSlug !== taskSlug) {
      return json(403, { error: 'job does not belong to this task' })
    }
    if (row.completedAt || row.hasError || row.processing) {
      return json(409, { error: 'job is not runnable' })
    }
    const input = (row.input ?? {}) as JsonObject

    const run = async (): Promise<void> => {
      try {
        await req.payload.jobs.runByID({ id: jobId })
      } catch (error) {
        req.payload.logger.warn(
          `[payload-video-optimizer] continued conversion run failed for job ${String(jobId)}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (!dispatch) {
      // Running here would block the response, and the caller awaits it — which on a
      // single process deadlocks against the per-document mutex it still holds. The
      // row is runnable, so leave it to whatever drains the queue. (Nothing should
      // reach this: the chain is only fired when a dispatch exists.)
      return json(202, { queued: true, ran: false })
    }

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
    return json(202, { queued: true, ran: true })
  },
  method: 'post',
  path: `/${taskSlug}/continue`,
})

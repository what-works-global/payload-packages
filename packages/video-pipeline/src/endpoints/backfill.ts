import type { Endpoint } from 'payload'

import { waitUntil } from '@vercel/functions'

import type { ResolvedVideoPipelineOptions } from '../types.js'

export function buildBackfillEndpoint(options: ResolvedVideoPipelineOptions): Endpoint {
  return {
    handler: async (req) => {
      const body = ((await req.json?.()) ?? {}) as { collection?: string }
      const targets = body.collection ? [body.collection] : options.collections

      const invalid = targets.find((slug) => !options.collections.includes(slug))
      if (invalid) {
        return Response.json({ error: `Unknown collection: ${invalid}` }, { status: 400 })
      }

      const jobs = await Promise.all(
        targets.map((collection) =>
          req.payload.jobs.queue({
            input: { collection },
            req,
            task: options.backfillTaskSlug,
          }),
        ),
      )
      waitUntil(Promise.all(jobs.map((job) => req.payload.jobs.runByID({ id: job.id, req }))))

      return Response.json({ jobIds: jobs.map((job) => job.id) })
    },
    method: 'post',
    path: '/video-pipeline/backfill',
  }
}

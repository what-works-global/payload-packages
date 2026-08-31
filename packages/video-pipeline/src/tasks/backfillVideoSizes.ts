import type { PayloadRequest } from 'payload'

import type { ResolvedVideoPipelineOptions } from '../types.js'

export interface BackfillVideoSizesInput {
  collection: string
}

export function buildBackfillHandler(options: ResolvedVideoPipelineOptions) {
  return async ({ input, req }: { input: BackfillVideoSizesInput; req: PayloadRequest }) => {
    const pageSize = 200
    let page = 1
    let queued = 0
    while (true) {
      const result = await req.payload.find({
        collection: input.collection,
        depth: 0,
        limit: pageSize,
        page,
        req,
        select: { id: true },
        where: { mimeType: { like: 'video' } },
      })
      for (const doc of result.docs) {
        await req.payload.jobs.queue({
          input: { collection: input.collection, mediaId: doc.id },
          req,
          task: options.taskSlug,
        })
        queued += 1
      }
      if (!result.hasNextPage) {
        break
      }
      page += 1
    }
    req.payload.logger.info(
      `[video-pipeline] backfill queued ${queued} job(s) for ${input.collection}`,
    )
    return { output: { queued } }
  }
}

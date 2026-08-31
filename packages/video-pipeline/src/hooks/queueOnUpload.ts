import type { CollectionAfterChangeHook } from 'payload'

import { waitUntil } from '@vercel/functions'

import type { ResolvedVideoPipelineOptions } from '../types.js'

export function buildQueueOnUploadHook(
  collectionSlug: string,
  options: ResolvedVideoPipelineOptions,
): CollectionAfterChangeHook {
  return async ({ context, doc, req }) => {
    if (context?.skipVideoPipelineQueue) {
      return doc
    }
    if (!doc?.mimeType?.startsWith?.('video')) {
      return doc
    }

    const job = await req.payload.jobs.queue({
      input: { collection: collectionSlug, mediaId: doc.id },
      req,
      task: options.taskSlug,
    })
    waitUntil(req.payload.jobs.runByID({ id: job.id, req }))
    return doc
  }
}

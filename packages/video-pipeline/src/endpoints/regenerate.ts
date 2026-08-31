import type { Endpoint } from 'payload'

import { waitUntil } from '@vercel/functions'

import type { ResolvedVideoPipelineOptions, VideoDerivativeEntry } from '../types.js'

export function buildRegenerateEndpoint(
  collectionSlug: string,
  options: ResolvedVideoPipelineOptions,
): Endpoint {
  return {
    handler: async (req) => {
      const mediaId = req.routeParams?.id
      if (typeof mediaId !== 'string') {
        return Response.json({ error: 'Missing media id' }, { status: 400 })
      }

      const doc = await req.payload.findByID({
        id: mediaId,
        collection: collectionSlug,
        req,
      })
      if (!doc?.mimeType?.startsWith?.('video')) {
        return Response.json({ error: 'Document is not a video' }, { status: 400 })
      }

      // Force every existing size to re-run regardless of staleness by
      // flipping status away from 'done' — the task treats anything but
      // 'done' as stale. Keep each entry's `derivative` id intact so the
      // task can still clean up the old file once the new one lands.
      const existing: VideoDerivativeEntry[] = doc.videoDerivatives ?? []
      if (existing.length > 0) {
        await req.payload.update({
          id: mediaId,
          collection: collectionSlug,
          context: { skipVideoPipelineQueue: true },
          data: {
            videoDerivatives: existing.map((entry) => ({ ...entry, status: 'pending' })),
          },
          req,
        })
      }

      const job = await req.payload.jobs.queue({
        input: { collection: collectionSlug, mediaId },
        req,
        task: options.taskSlug,
      })
      waitUntil(req.payload.jobs.runByID({ id: job.id, req }))

      return Response.json({ jobId: job.id })
    },
    method: 'post',
    path: '/:id/regenerate-video',
  }
}

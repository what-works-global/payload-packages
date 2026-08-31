import type { PayloadRequest } from 'payload'

import path from 'node:path'

import type {
  ResolvedVideoPipelineOptions,
  VideoDerivativeEntry,
  VideoSizeConfig,
} from '../types.js'

import { processVideoSize } from '../processors/video.js'
import { resolveSourceUrl } from '../utils/resolveSourceUrl.js'

export interface ProcessVideoAssetInput {
  collection: string
  mediaId: string
}

/**
 * Per-size diff — compares the doc's existing entry against the CURRENT
 * settings config for that slug. Only a real field difference (or a
 * missing/errored entry) counts as stale. Editing one size in a five-size
 * list only regenerates that one.
 */
function isStale(entry: undefined | VideoDerivativeEntry, size: VideoSizeConfig): boolean {
  if (!entry || entry.status !== 'done') {
    return true
  }
  return (
    entry.label !== size.label ||
    (entry.breakpointMinWidth ?? null) !== (size.breakpointMinWidth ?? null) ||
    entry.resolutionHeight !== size.resolutionHeight ||
    entry.format !== size.format ||
    (entry.videoBitrateKbps ?? null) !== (size.videoBitrateKbps ?? null) ||
    (entry.crf ?? null) !== (size.crf ?? null) ||
    entry.audioBitrateKbps !== size.audioBitrateKbps ||
    entry.cpuUsed !== size.cpuUsed
  )
}

export function buildProcessVideoAssetHandler(options: ResolvedVideoPipelineOptions) {
  return async ({ input, req }: { input: ProcessVideoAssetInput; req: PayloadRequest }) => {
    const doc = await req.payload.findByID({
      id: input.mediaId,
      collection: input.collection,
      req,
    })
    if (!doc?.mimeType?.startsWith('video')) {
      return { output: { skipped: true } }
    }
    if (!doc?.url) {
      throw new Error(`Media doc ${input.mediaId} has no source url yet`)
    }

    const settings = await req.payload.findGlobal({ slug: options.settingsGlobalSlug, req })
    const sizes: VideoSizeConfig[] = settings?.videoSizes ?? []
    if (sizes.length === 0) {
      return { output: { skipped: true } }
    }

    const existing: VideoDerivativeEntry[] = doc.videoDerivatives ?? []
    const bySlug = new Map(existing.map((entry) => [entry.sizeSlug, entry]))
    const toRun = sizes.filter((size) => isStale(bySlug.get(size.slug), size))
    if (toRun.length === 0) {
      return { output: { skipped: true } }
    }

    // Mark as 'processing' up front, but KEEP each entry's existing
    // `derivative` id — a doc must keep pointing at its last-known-good
    // file until a replacement is ready, never at nothing.
    const map = new Map(bySlug)
    for (const size of toRun) {
      const prev = map.get(size.slug)
      map.set(size.slug, { ...prev, sizeSlug: size.slug, status: 'processing' })
    }
    await req.payload.update({
      id: input.mediaId,
      collection: input.collection,
      context: { skipVideoPipelineQueue: true },
      data: { videoDerivatives: [...map.values()] },
      req,
    })

    const sourceUrl = resolveSourceUrl(doc.url, req.payload.config.serverURL)
    const sourceRes = await fetch(sourceUrl)
    if (!sourceRes.ok) {
      throw new Error(`Failed to fetch source (${sourceRes.status}): ${sourceUrl}`)
    }
    const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer())
    const sourceExt = path.extname(new URL(sourceUrl).pathname) || '.mp4'

    for (const size of toRun) {
      const prevEntry = bySlug.get(size.slug)
      try {
        const result = await processVideoSize(sourceBuffer, sourceExt, size)
        const baseName = path.basename(doc.filename ?? 'video', path.extname(doc.filename ?? ''))
        const filename = `${baseName}-${size.slug}.${size.format}`

        const created = await req.payload.create({
          collection: options.derivativesCollectionSlug,
          data: {
            audioBitrateKbps: size.audioBitrateKbps,
            breakpointMinWidth: size.breakpointMinWidth ?? null,
            cpuUsed: size.cpuUsed,
            crf: size.crf ?? null,
            encodedHeight: result.height,
            encodedWidth: result.width,
            format: size.format,
            generatedAt: new Date().toISOString(),
            label: size.label,
            media: { relationTo: input.collection, value: input.mediaId },
            resolutionHeight: size.resolutionHeight,
            sizeSlug: size.slug,
            videoBitrateKbps: size.videoBitrateKbps ?? null,
          },
          file: {
            name: filename,
            data: result.buffer,
            mimetype: `video/${size.format}`,
            size: result.buffer.length,
          },
          req,
        })

        // Only delete the OLD file now that the new one exists — never the reverse.
        if (prevEntry?.derivative) {
          await req.payload
            .delete({
              id: prevEntry.derivative,
              collection: options.derivativesCollectionSlug,
              req,
            })
            .catch((err: unknown) =>
              req.payload.logger.warn(
                `[video-pipeline] failed to clean up old derivative ${prevEntry.derivative}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            )
        }

        map.set(size.slug, {
          audioBitrateKbps: size.audioBitrateKbps,
          breakpointMinWidth: size.breakpointMinWidth ?? null,
          cpuUsed: size.cpuUsed,
          crf: size.crf ?? null,
          derivative: created.id as string,
          error: null,
          format: size.format,
          generatedAt: new Date().toISOString(),
          label: size.label,
          resolutionHeight: size.resolutionHeight,
          sizeSlug: size.slug,
          status: 'done',
          videoBitrateKbps: size.videoBitrateKbps ?? null,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        req.payload.logger.error(
          `[video-pipeline] size ${size.slug} failed for doc ${input.mediaId}: ${message}`,
        )
        // Preserve the previous working derivative — only status/error change.
        map.set(size.slug, {
          ...prevEntry,
          error: message,
          sizeSlug: size.slug,
          status: 'error',
        })
      }

      // Persist after every size — a mid-run crash only leaves the
      // still-stale sizes to redo, not everything.
      await req.payload.update({
        id: input.mediaId,
        collection: input.collection,
        context: { skipVideoPipelineQueue: true },
        data: { videoDerivatives: [...map.values()] },
        req,
      })
    }

    return { output: { derivatives: [...map.values()] } }
  }
}

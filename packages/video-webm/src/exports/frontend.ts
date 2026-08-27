/**
 * Frontend helpers for rendering optimised videos — deliberately dependency-free
 * (no `payload` import) so they can ship in any client or server bundle.
 *
 * Both helpers need the document queried with `depth: 1` (or more) so the
 * `webmVersions` relationships are populated with their `url`s; unpopulated rows
 * are silently ignored, which degrades gracefully to the original file.
 */

/** The slice of a populated upload document the helpers read — structural on purpose. */
export interface VideoDocLike {
  mimeType?: null | string
  url?: null | string
  webmVersions?:
    | {
        preset?: null | string
        video?: { mimeType?: null | string; url?: null | string } | null | number | string
      }[]
    | null
}

export interface VideoSource {
  /** Preset name for renditions; `null` for the original file. */
  preset: null | string
  src: string
  type: string
}

const populatedRenditions = (
  doc: null | undefined | VideoDocLike,
): { preset: string; type: string; url: string }[] => {
  const rows = doc?.webmVersions
  if (!Array.isArray(rows)) {
    return []
  }
  const renditions: { preset: string; type: string; url: string }[] = []
  for (const row of rows) {
    const video = row?.video
    if (!video || typeof video !== 'object' || typeof video.url !== 'string') {
      continue // id-only (unpopulated) — needs depth: 1.
    }
    renditions.push({
      type: typeof video.mimeType === 'string' ? video.mimeType : 'video/webm',
      preset: typeof row.preset === 'string' ? row.preset : '',
      url: video.url,
    })
  }
  return renditions
}

/**
 * URL of one optimised rendition, or `null` when it doesn't exist (yet). With no
 * `preset` argument, returns the most-preferred rendition (first in the preset
 * declaration order). Always pair with a fallback to the source:
 *
 * ```tsx
 * <video controls src={getWebmUrl(media, '720p') ?? media.url ?? undefined} />
 * ```
 */
export const getWebmUrl = (
  doc: null | undefined | VideoDocLike,
  preset?: string,
): null | string => {
  const renditions = populatedRenditions(doc)
  const match = preset ? renditions.find((r) => r.preset === preset) : renditions[0]
  return match?.url ?? null
}

/**
 * The full `<source>` list for a `<video>` element: every populated rendition in
 * preference order, then the original file as the guaranteed fallback — browsers
 * pick the first source they can play, so this always plays *something*:
 *
 * ```tsx
 * <video controls>
 *   {getVideoSources(media).map((s) => (
 *     <source key={s.src} src={s.src} type={s.type} />
 *   ))}
 * </video>
 * ```
 *
 * Pass `presets` to restrict and re-order the renditions (e.g. `['720p', '360p']`
 * for a small player); the original fallback is always appended.
 */
export const getVideoSources = (
  doc: null | undefined | VideoDocLike,
  options: { presets?: string[] } = {},
): VideoSource[] => {
  const renditions = populatedRenditions(doc)
  const ordered = options.presets
    ? options.presets.flatMap((name) => renditions.filter((r) => r.preset === name))
    : renditions

  const sources: VideoSource[] = ordered.map((r) => ({
    type: r.type,
    preset: r.preset || null,
    src: r.url,
  }))

  if (doc && typeof doc.url === 'string') {
    sources.push({
      type: typeof doc.mimeType === 'string' ? doc.mimeType : 'video/mp4',
      preset: null,
      src: doc.url,
    })
  }

  return sources
}

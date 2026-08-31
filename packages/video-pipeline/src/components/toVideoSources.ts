export interface RawVideoDerivativeEntry {
  breakpointMinWidth?: null | number
  derivative?: { id: string; mimeType?: string; url?: string } | null | string
  status?: string
}

export interface VideoDerivativeSource {
  breakpointMinWidth: null | number
  mimeType: string
  url: string
}

/**
 * Flattens the Payload relationship shape into the flat array `<Video>`
 * expects. Only `status: 'done'` entries with a *populated* `derivative`
 * (an object, not a bare id string) produce a source — an unpopulated
 * relationship has no `url`/`mimeType` to render, so query the media doc
 * with enough `depth` that `derivative` resolves.
 */
export function toVideoSources(
  entries?: null | RawVideoDerivativeEntry[],
): VideoDerivativeSource[] {
  if (!entries) {
    return []
  }

  const sources: VideoDerivativeSource[] = []
  for (const entry of entries) {
    if (entry.status !== 'done') {
      continue
    }

    const derivative = entry.derivative
    if (!derivative || typeof derivative === 'string') {
      continue
    }
    if (!derivative.url || !derivative.mimeType) {
      continue
    }

    sources.push({
      breakpointMinWidth: entry.breakpointMinWidth ?? null,
      mimeType: derivative.mimeType,
      url: derivative.url,
    })
  }
  return sources
}

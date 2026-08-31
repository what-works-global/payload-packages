import type { ResolvedVideoOptimizerConfig } from '../types.js'

/**
 * Downscale filter that caps dimensions without ever upscaling — `min(iw, max)`
 * keeps small sources untouched, `-2`/`force_original_aspect_ratio=decrease`
 * preserves aspect, and even dimensions are enforced for the 4:2:0 chroma grid.
 */
const buildScaleFilter = (maxWidth?: number, maxHeight?: number): null | string => {
  if (maxWidth && maxHeight) {
    return `scale='min(iw,${maxWidth})':'min(ih,${maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2`
  }
  if (maxWidth) {
    return `scale='min(iw,${maxWidth})':-2`
  }
  if (maxHeight) {
    return `scale=-2:'min(ih,${maxHeight})'`
  }
  return null
}

/** Payload stores focal points as percentages of the frame; 50/50 is dead centre. */
export interface FocalPoint {
  x: number
  y: number
}

export const CENTRE_FOCAL_POINT: FocalPoint = { x: 50, y: 50 }

/** Parses `'W:H'` into a width/height ratio. Returns `null` for anything unusable. */
export const parseAspectRatio = (value: string): null | number => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(value)
  if (!match) {
    return null
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!(width > 0) || !(height > 0)) {
    return null
  }
  return width / height
}

/**
 * The largest window of the target shape that fits inside the frame, positioned by
 * the focal point and clamped so it can never run off an edge.
 *
 * Everything is expressed in ffmpeg's own filter expressions rather than computed
 * from probed dimensions: the filter then adapts to whatever it is actually handed,
 * so a mis-probe or a rotated source can't silently produce a wrongly framed file.
 * `ow`/`oh` refer back to the crop's own computed size, and doubling a floored half
 * keeps both sides even for the 4:2:0 chroma grid.
 */
const buildCropFilter = (aspectRatio: number, focal: FocalPoint): string => {
  const ratio = aspectRatio.toFixed(6)
  const fx = (focal.x / 100).toFixed(4)
  const fy = (focal.y / 100).toFixed(4)
  const width = `2*floor(min(iw,ih*${ratio})/2)`
  const height = `2*floor(min(ih,iw/${ratio})/2)`
  const x = `max(0,min(iw-ow,${fx}*iw-ow/2))`
  const y = `max(0,min(ih-oh,${fy}*ih-oh/2))`
  return `crop='${width}':'${height}':'${x}':'${y}'`
}

export interface BuildFfmpegArgsOptions {
  encoding: ResolvedVideoOptimizerConfig['encoding']
  /** Focal point of the source document, for `aspectRatio` crops. Defaults to centre. */
  focal?: FocalPoint
  inputPath: string
  outputPath: string
}

/**
 * Assembles the full ffmpeg invocation for a WebM transcode. `extraArgs` land after
 * the generated output options (for most repeatable options ffmpeg honours the last
 * occurrence, so they usually win); `-f webm` is pinned so the container never
 * depends on the output path's extension. Everything is passed to `spawn` as an
 * argument array — no shell is involved, so paths and filenames are never
 * interpreted.
 */
export const buildFfmpegArgs = ({
  encoding,
  focal = CENTRE_FOCAL_POINT,
  inputPath,
  outputPath,
}: BuildFfmpegArgsOptions): string[] => {
  const ratio = encoding.aspectRatio ? parseAspectRatio(encoding.aspectRatio) : null
  // Crop first, then scale: reframing decides which pixels exist, and only then is
  // it meaningful to cap how many of them to keep.
  const filters = [
    ratio === null ? null : buildCropFilter(ratio, focal),
    buildScaleFilter(encoding.maxWidth, encoding.maxHeight),
  ].filter((filter): filter is string => filter !== null)

  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-c:v',
    encoding.codec === 'vp9' ? 'libvpx-vp9' : 'libvpx',
    '-crf',
    String(encoding.crf),
    '-b:v',
    encoding.videoBitrate,
    '-deadline',
    'good',
    '-cpu-used',
    String(encoding.speed),
    // row-mt is a libvpx-vp9 private option; libvpx (VP8) rejects it outright.
    ...(encoding.codec === 'vp9' ? ['-row-mt', '1'] : []),
    ...(encoding.pixelFormat === null ? [] : ['-pix_fmt', encoding.pixelFormat]),
    ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
    ...(encoding.audio ? ['-c:a', 'libopus', '-b:a', encoding.audioBitrate] : ['-an']),
    ...encoding.extraArgs,
    '-f',
    'webm',
    outputPath,
  ]
}

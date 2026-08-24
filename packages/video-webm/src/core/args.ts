import type { ResolvedVideoWebmConfig } from '../types.js'

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

export interface BuildFfmpegArgsOptions {
  encoding: ResolvedVideoWebmConfig['encoding']
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
  inputPath,
  outputPath,
}: BuildFfmpegArgsOptions): string[] => {
  const scaleFilter = buildScaleFilter(encoding.maxWidth, encoding.maxHeight)

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
    ...(scaleFilter ? ['-vf', scaleFilter] : []),
    '-c:a',
    'libopus',
    '-b:a',
    encoding.audioBitrate,
    ...encoding.extraArgs,
    '-f',
    'webm',
    outputPath,
  ]
}

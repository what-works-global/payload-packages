import { describe, expect, it } from 'vitest'

import { buildFfmpegArgs } from '../src/core/args.js'
import { resolveConfig } from '../src/core/defaults.js'

const encodingFor = (encoding: Parameters<typeof resolveConfig>[0]['encoding']) =>
  resolveConfig({ encoding }).encoding

const argsFor = (encoding: Parameters<typeof resolveConfig>[0]['encoding'] = {}) =>
  buildFfmpegArgs({
    encoding: encodingFor(encoding),
    inputPath: '/tmp/in.mp4',
    outputPath: '/tmp/out.webm',
  })

/** Value following a flag, e.g. valueOf(args, '-crf') === '32'. */
const valueOf = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

describe('buildFfmpegArgs', () => {
  it('defaults to VP9 constant-quality with Opus audio and a pinned webm container', () => {
    const args = argsFor()
    expect(valueOf(args, '-c:v')).toBe('libvpx-vp9')
    expect(valueOf(args, '-crf')).toBe('32')
    expect(valueOf(args, '-b:v')).toBe('0')
    expect(valueOf(args, '-c:a')).toBe('libopus')
    expect(valueOf(args, '-b:a')).toBe('128k')
    expect(valueOf(args, '-pix_fmt')).toBe('yuv420p')
    expect(valueOf(args, '-f')).toBe('webm')
    expect(args.at(-1)).toBe('/tmp/out.webm')
    expect(args).not.toContain('-vf')
  })

  it('gives VP8 a real bitrate ceiling, where -b:v 0 would disable rate control', () => {
    const args = argsFor({ codec: 'vp8' })
    expect(valueOf(args, '-c:v')).toBe('libvpx')
    expect(valueOf(args, '-b:v')).toBe('1M')
  })

  it('only passes the VP9-private -row-mt option to libvpx-vp9', () => {
    expect(argsFor({ codec: 'vp9' })).toContain('-row-mt')
    expect(argsFor({ codec: 'vp8' })).not.toContain('-row-mt')
  })

  it('never upscales when capping dimensions', () => {
    expect(valueOf(argsFor({ maxWidth: 1280 }), '-vf')).toBe(`scale='min(iw,1280)':-2`)
    expect(valueOf(argsFor({ maxHeight: 720 }), '-vf')).toBe(`scale=-2:'min(ih,720)'`)
    expect(valueOf(argsFor({ maxHeight: 720, maxWidth: 1280 }), '-vf')).toBe(
      `scale='min(iw,1280)':'min(ih,720)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    )
  })

  it('omits -pix_fmt when pixelFormat is null', () => {
    expect(argsFor({ pixelFormat: null })).not.toContain('-pix_fmt')
  })

  it('appends extraArgs after generated options so they win on conflict', () => {
    const args = argsFor({ extraArgs: ['-an'] })
    expect(args.indexOf('-an')).toBeGreaterThan(args.indexOf('-c:a'))
    expect(args.indexOf('-an')).toBeLessThan(args.indexOf('-f'))
  })
})

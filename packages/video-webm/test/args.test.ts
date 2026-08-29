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
    const args = argsFor({ extraArgs: ['-ac', '2'] })
    expect(args.indexOf('-ac')).toBeGreaterThan(args.indexOf('-c:a'))
    expect(args.indexOf('-ac')).toBeLessThan(args.indexOf('-f'))
  })

  it('drops the audio stream entirely when audio is disabled', () => {
    const args = argsFor({ audio: false })
    expect(args).toContain('-an')
    expect(args).not.toContain('-c:a')
    expect(args).not.toContain('-b:a')
  })

  it('crops to the target aspect ratio around the focal point, then scales', () => {
    const args = buildFfmpegArgs({
      encoding: encodingFor({ aspectRatio: '9:16', maxWidth: 1080 }),
      focal: { x: 25, y: 60 },
      inputPath: '/tmp/in.mp4',
      outputPath: '/tmp/out.webm',
    })
    const filters = valueOf(args, '-vf')!

    // Crop precedes scale: reframing decides which pixels exist before any cap on
    // how many to keep.
    expect(filters.indexOf('crop=')).toBeLessThan(filters.indexOf('scale='))
    // The window is the largest 9:16 rectangle that fits, both sides even.
    expect(filters).toContain(
      `crop='2*floor(min(iw,ih*0.562500)/2)':'2*floor(min(ih,iw/0.562500)/2)'`,
    )
    // Positioned by the focal point, clamped so it can never leave the frame.
    expect(filters).toContain(`'max(0,min(iw-ow,0.2500*iw-ow/2))'`)
    expect(filters).toContain(`'max(0,min(ih-oh,0.6000*ih-oh/2))'`)
    expect(filters).toContain(`scale='min(iw,1080)':-2`)
  })

  it('centres the crop when the document has no focal point', () => {
    const filters = valueOf(argsFor({ aspectRatio: '1:1' }), '-vf')!
    expect(filters).toContain(`'max(0,min(iw-ow,0.5000*iw-ow/2))'`)
    expect(filters).toContain(`'max(0,min(ih-oh,0.5000*ih-oh/2))'`)
  })
})

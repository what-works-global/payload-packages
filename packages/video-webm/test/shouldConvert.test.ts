import { describe, expect, it } from 'vitest'

import { DEFAULT_INPUT_MIME_TYPES, resolveConfig } from '../src/core/defaults.js'
import { mimeTypeMatches, shouldConvert, toWebmFilename } from '../src/core/shouldConvert.js'

const config = (overrides: Parameters<typeof resolveConfig>[0] = {}) => resolveConfig(overrides)

describe('mimeTypeMatches', () => {
  it('matches exact types case-insensitively', () => {
    expect(mimeTypeMatches('video/mp4', 'video/MP4')).toBe(true)
    expect(mimeTypeMatches('video/mp4', 'video/mpeg')).toBe(false)
  })

  it('matches subtype wildcards', () => {
    expect(mimeTypeMatches('video/*', 'video/x-matroska')).toBe(true)
    expect(mimeTypeMatches('video/*', 'image/png')).toBe(false)
  })
})

describe('shouldConvert', () => {
  it('converts the default video types', () => {
    for (const mimetype of DEFAULT_INPUT_MIME_TYPES) {
      expect(shouldConvert({ mimetype, size: 100 }, config())).toEqual({ convert: true })
    }
  })

  it('skips non-video uploads', () => {
    expect(shouldConvert({ mimetype: 'image/png', size: 100 }, config())).toEqual({
      convert: false,
      reason: 'mime-not-matched',
    })
  })

  it('never re-encodes webm, even when the allowlist names it explicitly', () => {
    for (const inputMimeTypes of [['video/*'], ['video/webm'], ['video/webm', 'video/mp4']]) {
      expect(
        shouldConvert({ mimetype: 'video/webm', size: 100 }, config({ inputMimeTypes })),
      ).toEqual({ convert: false, reason: 'already-webm' })
    }
  })

  it('skips unusual and unsupported mime types', () => {
    for (const mimetype of ['application/octet-stream', 'application/mp4', 'video', '', 'VIDEO/']) {
      expect(shouldConvert({ mimetype, size: 100 }, config())).toEqual({
        convert: false,
        reason: 'mime-not-matched',
      })
    }
  })

  it('skips files above maxInputFileSize', () => {
    const limited = config({ maxInputFileSize: 1_000 })
    expect(shouldConvert({ mimetype: 'video/mp4', size: 1_001 }, limited)).toEqual({
      convert: false,
      reason: 'input-too-large',
    })
    expect(shouldConvert({ mimetype: 'video/mp4', size: 1_000 }, limited)).toEqual({
      convert: true,
    })
  })
})

describe('toWebmFilename', () => {
  it('swaps the extension', () => {
    expect(toWebmFilename('clip.mp4')).toBe('clip.webm')
    expect(toWebmFilename('archive.tar.mov')).toBe('archive.tar.webm')
  })

  it('handles uppercase extensions', () => {
    expect(toWebmFilename('Holiday.MP4')).toBe('Holiday.webm')
    expect(toWebmFilename('CLIP.MOV')).toBe('CLIP.webm')
  })

  it('appends when there is no extension, including dotfiles', () => {
    expect(toWebmFilename('clip')).toBe('clip.webm')
    expect(toWebmFilename('.hidden')).toBe('.hidden.webm')
  })

  it('preserves unicode base names', () => {
    expect(toWebmFilename('видео-отпуск.mp4')).toBe('видео-отпуск.webm')
    expect(toWebmFilename('動画 テスト.mov')).toBe('動画 テスト.webm')
  })
})

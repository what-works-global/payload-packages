import { describe, expect, it } from 'vitest'

import { resolutionPresets, resolveConfig } from '../src/core/defaults.js'

describe('resolveConfig validation', () => {
  it('rejects out-of-range crf', () => {
    expect(() => resolveConfig({ encoding: { crf: 64 } })).toThrow(/encoding\.crf/)
    expect(() => resolveConfig({ encoding: { crf: -1 } })).toThrow(/encoding\.crf/)
    expect(() => resolveConfig({ encoding: { crf: 31.5 } })).toThrow(/encoding\.crf/)
    expect(() => resolveConfig({ encoding: { crf: 0 } })).not.toThrow()
    expect(() => resolveConfig({ encoding: { crf: 63 } })).not.toThrow()
  })

  it('bounds speed per codec: 0–5 for VP9, 0–16 for VP8', () => {
    expect(() => resolveConfig({ encoding: { speed: 6 } })).toThrow(/encoding\.speed/)
    expect(() => resolveConfig({ encoding: { codec: 'vp8', speed: 6 } })).not.toThrow()
    expect(() => resolveConfig({ encoding: { codec: 'vp8', speed: 17 } })).toThrow(
      /encoding\.speed/,
    )
  })

  it('rejects non-positive dimensions', () => {
    expect(() => resolveConfig({ encoding: { maxWidth: 0 } })).toThrow(/encoding\.maxWidth/)
    expect(() => resolveConfig({ encoding: { maxHeight: -720 } })).toThrow(/encoding\.maxHeight/)
    expect(() => resolveConfig({ encoding: { maxWidth: 1280.5 } })).toThrow(/encoding\.maxWidth/)
  })

  it('rejects invalid timeout, size cap, concurrency and retry values', () => {
    expect(() => resolveConfig({ timeoutMs: 0 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ timeoutMs: -1 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ maxInputFileSize: 0 })).toThrow(/maxInputFileSize/)
    expect(() => resolveConfig({ maxConcurrentEncodes: 0 })).toThrow(/maxConcurrentEncodes/)
    expect(() => resolveConfig({ maxConcurrentEncodes: 1.5 })).toThrow(/maxConcurrentEncodes/)
    expect(() => resolveConfig({ retries: -1 })).toThrow(/retries/)
    expect(() => resolveConfig({ retries: 1.5 })).toThrow(/retries/)
    expect(() => resolveConfig({ retries: 0 })).not.toThrow()
  })

  it('rejects a codec outside the union at runtime', () => {
    expect(() => resolveConfig({ encoding: { codec: 'h264' as unknown as 'vp9' } })).toThrow(
      /encoding\.codec/,
    )
  })

  it('defaults maxConcurrentEncodes to 2, with null opting into unlimited', () => {
    expect(resolveConfig({}).maxConcurrentEncodes).toBe(2)
    expect(resolveConfig({ maxConcurrentEncodes: null }).maxConcurrentEncodes).toBeNull()
    expect(resolveConfig({ maxConcurrentEncodes: 8 }).maxConcurrentEncodes).toBe(8)
  })

  it('validates presets: names, per-preset encoding, and non-emptiness', () => {
    expect(() => resolveConfig({ presets: {} })).toThrow(/at least one rendition/)
    expect(() => resolveConfig({ presets: { 'bad name!': {} } })).toThrow(/preset name/)
    expect(() => resolveConfig({ presets: { p720: { encoding: { crf: 99 } } } })).toThrow(
      /presets\.p720\.encoding\.crf/,
    )
  })

  it('merges preset encoding over the base encoding and defaults labels to keys', () => {
    const resolved = resolveConfig({
      encoding: { audioBitrate: '96k', codec: 'vp8' },
      presets: { hd: { encoding: { maxHeight: 720 }, label: '720p HD' }, tiny: {} },
    })
    expect(Object.keys(resolved.presets)).toEqual(['hd', 'tiny'])
    expect(resolved.presets.hd).toMatchObject({
      encoding: { audioBitrate: '96k', codec: 'vp8', maxHeight: 720 },
      label: '720p HD',
    })
    expect(resolved.presets.tiny.label).toBe('tiny')
    expect(resolved.presets.tiny.encoding.audioBitrate).toBe('96k')
  })

  it("resolutionPresets builds Google's CRF ladder without upscaling", () => {
    const presets = resolutionPresets([360, 1080])
    expect(Object.keys(presets)).toEqual(['360p', '1080p'])
    expect(presets['360p'].encoding).toEqual({ crf: 36, maxHeight: 360 })
    expect(presets['1080p'].encoding).toEqual({ crf: 31, maxHeight: 1080 })
    // Unknown heights fall back to the plugin's CRF default.
    expect(resolutionPresets([333])['333p'].encoding).toEqual({ crf: 32, maxHeight: 333 })
    // Default ladder.
    expect(Object.keys(resolutionPresets())).toEqual(['360p', '720p', '1080p'])
  })

  it('accepts a fully defaulted config', () => {
    const resolved = resolveConfig({})
    expect(resolved.encoding.codec).toBe('vp9')
    expect(resolved.encoding.videoBitrate).toBe('0')
    expect(resolved.skipIfLarger).toBe(true)
    expect(resolved.shouldConvert).toBeNull()
    expect(resolved.onConversionComplete).toBeNull()
    expect(resolved.fetchSource).toBeNull()
    expect(Object.keys(resolved.presets)).toEqual(['webm'])
  })
})

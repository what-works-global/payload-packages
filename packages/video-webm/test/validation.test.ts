import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/core/defaults.js'

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

  it('rejects invalid timeout, size cap and concurrency values', () => {
    expect(() => resolveConfig({ timeoutMs: 0 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ timeoutMs: -1 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ maxInputFileSize: 0 })).toThrow(/maxInputFileSize/)
    expect(() => resolveConfig({ maxConcurrentEncodes: 0 })).toThrow(/maxConcurrentEncodes/)
    expect(() => resolveConfig({ maxConcurrentEncodes: 1.5 })).toThrow(/maxConcurrentEncodes/)
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

  it('accepts a fully defaulted config', () => {
    const resolved = resolveConfig({})
    expect(resolved.encoding.codec).toBe('vp9')
    expect(resolved.encoding.videoBitrate).toBe('0')
    expect(resolved.onError).toBe('throw')
    expect(resolved.skipIfLarger).toBe(true)
    expect(resolved.shouldConvert).toBeNull()
    expect(resolved.onConversionComplete).toBeNull()
  })
})

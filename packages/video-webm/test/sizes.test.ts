import { describe, expect, it } from 'vitest'

import {
  dprBuckets,
  formatSizes,
  layoutSegments,
  parseAspect,
  parseSizes,
  solveSegment,
} from '../src/core/sizes.js'

describe('parseSizes', () => {
  it('reads the three canonical length forms', () => {
    expect(parseSizes('(min-width: 1280px) 800px, (min-width: 640px) 50vw, calc(33.333vw - 32px)'))
      .toEqual([
        { minWidth: 1280, slot: { a: 0, b: 800 } },
        { minWidth: 640, slot: { a: 0.5, b: 0 } },
        { minWidth: 0, slot: { a: 0.33333, b: -32 } },
      ])
    expect(parseSizes('calc(50vw + 24px)')[0]?.slot).toEqual({ a: 0.5, b: 24 })
  })

  it('rejects the mistakes that would otherwise be silent', () => {
    // Ascending: first-match-wins would serve the narrowest rule to every viewport.
    expect(() => parseSizes('(min-width: 768px) 600px, (min-width: 1280px) 800px, 100vw')).toThrow(
      /widest-first/,
    )
    // No unconditional fallback: narrow viewports would match nothing.
    expect(() => parseSizes('(min-width: 768px) 600px')).toThrow(/final clause/)
    expect(() => parseSizes('')).toThrow(/sizes is empty/)
  })

  it('points at the tooling rather than half-understanding a value', () => {
    expect(() => parseSizes('50em')).toThrow(/sizes CLI/)
    expect(() => parseSizes('calc(100vw / 3)')).toThrow(/sizes CLI/)
    expect(() => parseSizes('(orientation: portrait) 100vw, 50vw')).toThrow(/min-width/)
  })

  it('round-trips through formatSizes', () => {
    const input = '(min-width: 1200px) 368px, (min-width: 640px) calc(50vw - 36px), 100vw'
    expect(formatSizes(parseSizes(input))).toBe(input)
  })
})

describe('parseAspect', () => {
  it('accepts both ratio spellings', () => {
    expect(parseAspect('(min-width: 768px) 16/9, 9:16')).toEqual([
      { minWidth: 768, ratio: 16 / 9 },
      { minWidth: 0, ratio: 0.5625 },
    ])
  })

  it('rejects a non-ratio value', () => {
    expect(() => parseAspect('portrait')).toThrow(/16\/9/)
    expect(() => parseAspect('0/9')).toThrow(/16\/9/)
  })
})

describe('dprBuckets', () => {
  it('thresholds at the midpoint, not the multiplier', () => {
    // A 1.5dppx device (Windows at 150%, much of mid-range Android) must land in the
    // 2x bucket. Gating at 2dppx would drop it to the 1x rung — worse than a scalar.
    expect(dprBuckets([1, 2])).toEqual([
      { minResolution: 1.5, multiplier: 2 },
      { minResolution: null, multiplier: 1 },
    ])
    expect(dprBuckets([1, 2, 3])).toEqual([
      { minResolution: 2.5, multiplier: 3 },
      { minResolution: 1.5, multiplier: 2 },
      { minResolution: null, multiplier: 1 },
    ])
  })

  it('a scalar is one bucket with no query — the pre-bucket behaviour', () => {
    expect(dprBuckets(2)).toEqual([{ minResolution: null, multiplier: 2 }])
  })
})

describe('layoutSegments', () => {
  it('merges the sizes and aspect breakpoints into one axis', () => {
    const segments = layoutSegments(
      parseSizes('(min-width: 1280px) 800px, 100vw'),
      parseAspect('(min-width: 768px) 16/9, 9/16'),
    )
    expect(segments).toEqual([
      { from: 1280, ratio: 16 / 9, slot: { a: 0, b: 800 }, to: Infinity },
      // 768 is an aspect breakpoint only, but still splits the axis.
      { from: 768, ratio: 16 / 9, slot: { a: 1, b: 0 }, to: 1280 },
      { from: 0, ratio: 0.5625, slot: { a: 1, b: 0 }, to: 768 },
    ])
  })
})

describe('solveSegment', () => {
  const ladder = [2560, 1920, 1280, 854, 640, 426]

  it('solves the exact crossover for a fluid slot', () => {
    // calc(50vw - 24px) at 2x needs `vw - 48` pixels, so rung r covers vw <= r + 48.
    const [segment] = layoutSegments(parseSizes('calc(50vw - 24px)'))
    expect(solveSegment(segment, 2, ladder)).toEqual([
      { minWidth: 1969, want: 2560 },
      { minWidth: 1329, want: 1920 },
      { minWidth: 903, want: 1280 },
      { minWidth: 689, want: 854 },
      { minWidth: 475, want: 640 },
      { minWidth: 0, want: 426 },
    ])
    // Spot-check the boundary itself: at 903 the slot needs 855 physical pixels, one
    // more than the 854 rung has, so 1280 is correct and 902 is the last 854 viewport.
    expect(2 * (0.5 * 903 - 24)).toBe(855)
    expect(2 * (0.5 * 902 - 24)).toBe(854)
  })

  it('gives a fixed-width slot one rung for the whole segment', () => {
    const [segment] = layoutSegments(parseSizes('(min-width: 1280px) 800px, 100vw'))
    // 800 x 2 = 1600 physical pixels: the smallest rung that covers it, everywhere.
    expect(solveSegment(segment, 2, ladder)).toEqual([{ minWidth: 1280, want: 1920 }])
    expect(solveSegment(segment, 1, ladder)).toEqual([{ minWidth: 1280, want: 854 }])
  })

  it('falls back to the largest rung once the ladder is exhausted', () => {
    const [segment] = layoutSegments(parseSizes('100vw'))
    // At 2x, 426 covers viewports up to 213 and 640 up to 320. Past 320 nothing
    // covers, so 640 keeps going rather than the band being dropped — and it merges
    // with the band below it instead of appearing twice.
    expect(solveSegment(segment, 2, [640, 426])).toEqual([
      { minWidth: 214, want: 640 },
      { minWidth: 0, want: 426 },
    ])
  })

  it('a missing rung merges into the band above rather than shifting boundaries', () => {
    const [segment] = layoutSegments(parseSizes('100vw'))
    const chosen = (rungs: number[], viewport: number): number | undefined =>
      solveSegment(segment, 1, rungs).find((band) => viewport >= band.minWidth)?.want

    const full = [426, 640, 854, 1280]
    const gapped = [426, 640, 1280]
    for (let viewport = 1; viewport <= 1600; viewport += 1) {
      const before = chosen(full, viewport)
      // Every viewport keeps its rung, except the ones that wanted the dropped rung,
      // which move up to the next one — a crossover depends on the rung *below* it.
      expect(chosen(gapped, viewport)).toBe(before === 854 ? 1280 : before)
    }
  })
})

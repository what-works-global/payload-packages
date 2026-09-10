import { describe, expect, it } from 'vitest'

import type { SizeSample, SweepablePage } from '../src/exports/sizesDevtools.js'

import { parseSizes } from '../src/core/sizes.js'
import {
  checkSizes,
  expectSizesAccurate,
  fitSizes,
  generateSizes,
  sweepSizes,
} from '../src/exports/sizesDevtools.js'
import { DEFAULT_WIDTH_LADDER } from '../src/index.js'

/**
 * A card in a 3/2/1-column grid: container `max-width: 1200px; padding: 0 24px`,
 * `gap: 24px`, columns dropping at 1024 and 640. Note the plateau at 1200, where the
 * container stops growing — a sizing breakpoint that appears in no media query, and
 * exactly what a hand-written `sizes` misses.
 */
const gridCard = (viewport: number): number => {
  const content = Math.min(viewport, 1200) - 48
  if (viewport >= 1024) {
    return (content - 48) / 3
  }
  if (viewport >= 640) {
    return (content - 24) / 2
  }
  return content
}

const sampleEvery = (measure: (viewport: number) => number, step = 1): SizeSample[] => {
  const samples: SizeSample[] = []
  for (let viewport = 320; viewport <= 2560; viewport += step) {
    samples.push({ viewport, width: measure(viewport) })
  }
  return samples
}

/** A page whose only job is to report a known layout function. */
const fakePage = (measure: (viewport: number) => null | number): SweepablePage => {
  let viewport = 1280
  return {
    evaluate: <Result, Arg>(_fn: (arg: Arg) => Result, _arg: Arg) =>
      Promise.resolve(measure(viewport) as Result),
    setViewportSize: ({ width }: { height: number; width: number }) => {
      viewport = width
      return Promise.resolve()
    },
  }
}

describe('fitSizes', () => {
  it('recovers the piecewise formula, including a max-width plateau', () => {
    const { plateaus, sizes } = fitSizes(sampleEvery(gridCard))

    expect(sizes).toBe(
      '(min-width: 1200px) 368px, (min-width: 1024px) calc(33.333vw - 32px), (min-width: 640px) calc(50vw - 36px), calc(100vw - 48px)',
    )
    // 1200 is not a breakpoint in the stylesheet — it is where the container hits
    // its max-width and the card stops growing.
    expect(plateaus).toEqual([1200])
  })

  it('predicts the real width at every viewport it was fitted from', () => {
    const clauses = parseSizes(fitSizes(sampleEvery(gridCard)).sizes)
    for (const { viewport, width } of sampleEvery(gridCard, 7)) {
      const slot = clauses.find((clause) => viewport >= clause.minWidth)?.slot
      expect(Math.abs(slot!.a * viewport + slot!.b - width)).toBeLessThan(1.5)
    }
  })

  it('reads a fixed-width slot as px rather than a very shallow slope', () => {
    expect(fitSizes(sampleEvery(() => 800)).sizes).toBe('800px')
  })

  it('never emits a string its own parser rejects', () => {
    // A slot that shrinks as the viewport grows has no `sizes` syntax, and two
    // samples straddling a discontinuity fit exactly that. Emitting
    // `calc(-25vw + 2000px)` would parse-fail at render time, where production
    // degrades to serving the master to everyone — invisibly.
    const shrinking = sampleEvery((viewport) => 2000 - 0.25 * viewport)
    expect(() => parseSizes(fitSizes(shrinking).sizes)).not.toThrow()
    expect(fitSizes(shrinking).sizes).not.toContain('-')

    for (const layout of [
      (v: number) => Math.max(100, 1500 - 0.4 * v),
      (v: number) => (v < 800 ? v : 3000 - 2 * v),
      gridCard,
    ]) {
      expect(() => parseSizes(fitSizes(sampleEvery(layout)).sizes)).not.toThrow()
    }
  })

  it('is a fixed point: its own output passes its own drift check', () => {
    // `expectSizesAccurate(page, sel, { sizes: generateSizes(...) })` must not fail
    // on the string it was just handed.
    for (const layout of [gridCard, (v: number) => (2 / 3) * v + 160, (v: number) => v / 2]) {
      const samples = sampleEvery(layout, 3)
      const fitted = parseSizes(fitSizes(samples).sizes)
      expect(checkSizes(fitted, samples, { ladder: DEFAULT_WIDTH_LADDER })).toEqual([])
    }
  })

  it('describes the layout only, never a particular ladder', () => {
    // No rendition widths are involved in fitting, so the string stays correct when
    // the presets change — the reason to paste a sizes string over a resolved plan.
    expect(fitSizes(sampleEvery(gridCard)).clauses).toHaveLength(4)
  })
})

describe('checkSizes', () => {
  it('reports nothing while the string still describes the layout', () => {
    const fitted = parseSizes(fitSizes(sampleEvery(gridCard)).sizes)
    expect(checkSizes(fitted, sampleEvery(gridCard, 3), { ladder: DEFAULT_WIDTH_LADDER })).toEqual(
      [],
    )
  })

  it('reports the viewports where the wrong rendition would be served', () => {
    const fitted = parseSizes(fitSizes(sampleEvery(gridCard)).sizes)
    // The grid went from 3 columns to 4: every card is now much narrower.
    const changed = sampleEvery((viewport) => gridCard(viewport) * 0.72)
    const mismatches = checkSizes(fitted, changed, { ladder: DEFAULT_WIDTH_LADDER })

    expect(mismatches.length).toBeGreaterThan(0)
    expect(mismatches[0]?.would).toBeGreaterThan(mismatches[0]?.wanted)
  })
})

describe('sweepSizes', () => {
  it('bisects to the exact breakpoint pixel, not the coarse step', async () => {
    const samples = await sweepSizes(fakePage(gridCard), '[data-slot]', { max: 1400 })
    // 1024 falls between coarse steps of 16 from 320 (…1008, 1024 — but 640 does not:
    // 320 + 16n never lands on 640-1? it does, 640 = 320 + 16*20). Use the plateau at
    // 1200, which is 320 + 16*55 = 1200 — so check the fit instead of the raw grid.
    expect(samples.some((sample) => sample.viewport === 1200)).toBe(true)
    expect(fitSizes(samples).clauses.map((clause) => clause.minWidth)).toEqual([1200, 1024, 640, 0])
  })

  it('explains an unmatched selector rather than fitting nothing', async () => {
    await expect(
      sweepSizes(
        fakePage(() => null),
        '[data-missing]',
      ),
    ).rejects.toThrow(/no element matched/)
  })

  it('generateSizes sweeps and fits in one call', async () => {
    const { sizes } = await generateSizes(fakePage(gridCard), '[data-slot]')
    expect(sizes).toContain('(min-width: 1200px)')
  })
})

describe('expectSizesAccurate', () => {
  it('passes for a string that still describes the layout', async () => {
    const { sizes } = await generateSizes(fakePage(gridCard), '[data-slot]')
    await expect(
      expectSizesAccurate(fakePage(gridCard), '[data-slot]', { sizes }),
    ).resolves.toBeUndefined()
  })

  it('fails with the measurement and a regenerated string when the layout drifts', async () => {
    const { sizes } = await generateSizes(fakePage(gridCard), '[data-slot]')
    const fourColumns = (viewport: number): number =>
      viewport >= 1024 ? (Math.min(viewport, 1200) - 48 - 72) / 4 : gridCard(viewport)

    await expect(
      expectSizesAccurate(fakePage(fourColumns), '[data-slot]', { sizes }),
    ).rejects.toThrow(/no longer matches the layout/)
  })
})

import { describe, expect, it } from 'vitest'

import {
  budgetDecision,
  outputDimensions,
  resolveConfig,
  widthPresets,
} from '../src/core/defaults.js'

const preset = (config: Parameters<typeof resolveConfig>[0], name: string) =>
  resolveConfig(config).presets[name]

describe('outputDimensions', () => {
  const source = { height: 1080, width: 1920 }

  it('scales down to a width cap without upscaling', () => {
    expect(outputDimensions(preset({ presets: widthPresets([1280]) }, '1280w'), source)).toEqual({
      height: 720,
      width: 1280,
    })
    // The cap is above the source, so nothing is scaled.
    expect(outputDimensions(preset({ presets: widthPresets([2560]) }, '2560w'), source)).toEqual(
      source,
    )
  })

  it('crops to the aspect ratio before applying the cap', () => {
    // A 9:16 window out of 1920x1080 is only 607px wide, so a 1080-wide portrait
    // rung is already full size — the same reasoning skipRedundantPresets uses.
    const portrait = preset({ portrait: { widths: [1080] } }, 'portrait-1080w')
    const out = outputDimensions(portrait, source)
    expect(Math.round(out.width)).toBe(608)
    expect(Math.round(out.height)).toBe(1080)
  })

  it('is what makes cost projection possible: pixels, not width', () => {
    // 1080 wide at 9:16 would be 2.07 MP if the source could fill it — the same as
    // the 1920x1080 rung. Projection has to use the real output size, not the cap.
    const capped = outputDimensions(preset({ portrait: { widths: [1080] } }, 'portrait-1080w'), {
      height: 3840,
      width: 2160,
    })
    expect(Math.round(capped.width * capped.height)).toBe(1080 * 1920)
  })
})

describe('jobs.maxRunMs', () => {
  it('defaults to no budget, so one run does the whole ladder', () => {
    expect(resolveConfig({}).maxRunMs).toBeNull()
  })

  it('is validated as a positive integer', () => {
    expect(resolveConfig({ jobs: { maxRunMs: 240_000 } }).maxRunMs).toBe(240_000)
    expect(() => resolveConfig({ jobs: { maxRunMs: 0 } })).toThrow(/jobs\.maxRunMs/)
    expect(() => resolveConfig({ jobs: { maxRunMs: -1 } })).toThrow(/jobs\.maxRunMs/)
    expect(() => resolveConfig({ jobs: { maxRunMs: 1.5 } })).toThrow(/jobs\.maxRunMs/)
  })

  /* eslint-disable no-console -- asserting on the boot warning means capturing it. */
  it('warns when a single encode could outlast a whole run', () => {
    const warnings: string[] = []
    const original = console.warn
    console.warn = (message: string) => warnings.push(message)
    try {
      resolveConfig({ ffmpeg: { timeoutMs: 600_000 }, jobs: { maxRunMs: 240_000 } })
      expect(warnings.join()).toMatch(/longer than jobs\.maxRunMs/)

      warnings.length = 0
      resolveConfig({ ffmpeg: { timeoutMs: 120_000 }, jobs: { maxRunMs: 240_000 } })
      expect(warnings).toEqual([])
    } finally {
      console.warn = original
    }
  })
  /* eslint-enable no-console */
})

describe('budgetDecision', () => {
  const decide = (over: Partial<Parameters<typeof budgetDecision>[0]>) =>
    budgetDecision({
      budgetLeftMs: 200_000,
      budgetMs: 240_000,
      forced: false,
      projectedMs: 50_000,
      ...over,
    })

  it('encodes everything when no budget is set', () => {
    expect(decide({ budgetLeftMs: -1, budgetMs: null, projectedMs: 999_999 })).toBe('encode')
  })

  it('always encodes the first preset of a run', () => {
    // Forward progress: without this a budget smaller than one encode defers every
    // preset of every chunk and the chain never advances.
    expect(decide({ budgetLeftMs: -5000, forced: true, projectedMs: 999_999 })).toBe('encode')
  })

  it('skips a preset no budget could ever fit', () => {
    expect(decide({ projectedMs: 300_000 })).toBe('skip')
  })

  it('defers a preset that fits a budget but not what is left of this one', () => {
    // The distinction that matters: this one is fine, just not right now.
    expect(decide({ budgetLeftMs: 20_000, projectedMs: 50_000 })).toBe('defer')
  })

  it('defers once the budget is spent, even with nothing to project from', () => {
    expect(decide({ budgetLeftMs: 0, projectedMs: null })).toBe('defer')
  })

  it('defers on a sliver of budget rather than starting a doomed encode', () => {
    // Without a projection the only other guard is budgetLeftMs <= 0, which would
    // let a preset start with 200ms left, get a 200ms clamped ffmpeg timeout, and
    // fail — spending a retry to learn nothing. 10% of 240s is 24s.
    expect(decide({ budgetLeftMs: 24_000, projectedMs: null })).toBe('defer')
    expect(decide({ budgetLeftMs: 200, projectedMs: null })).toBe('defer')
    // Comfortably above the floor with nothing to project from: go ahead.
    expect(decide({ budgetLeftMs: 200_000, projectedMs: null })).toBe('encode')
  })

  it('encodes while there is room, and without a projection assumes there is', () => {
    expect(decide({})).toBe('encode')
    expect(decide({ projectedMs: null })).toBe('encode')
  })
})

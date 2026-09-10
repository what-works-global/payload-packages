/**
 * Development-time tooling for the `sizes` string `getVideoSourceSet` takes.
 *
 * Generating `sizes` by measuring beats writing it by hand for a reason that has
 * nothing to do with arithmetic: measurement sees the layout you actually shipped —
 * through Tailwind, CSS-in-JS, container queries and `max-width` plateaus alike —
 * whereas reading it off your breakpoint list sees only the breakpoints you wrote.
 *
 * Nothing here is imported by the runtime helpers, and it deliberately does not
 * depend on Playwright: pass in a page object and it uses the two methods it needs,
 * so Playwright, Puppeteer or your own harness all work and no consumer of the
 * plugin installs a browser.
 */

import type { SizeSample, SizesMismatch } from '../core/fitSizes.js'

import { DEFAULT_WIDTH_LADDER } from '../core/defaults.js'
import { checkSizes, fitSizes } from '../core/fitSizes.js'
import { parseSizes } from '../core/sizes.js'

export type {
  FitSizesOptions,
  FitSizesResult,
  SizeSample,
  SizesMismatch,
} from '../core/fitSizes.js'
export { checkSizes, fitSizes } from '../core/fitSizes.js'

/**
 * The slice of a Playwright/Puppeteer `Page` the sweep uses. Structural on purpose,
 * so this module has no browser dependency of its own.
 */
export interface SweepablePage {
  evaluate<Result, Arg>(fn: (arg: Arg) => Result, arg: Arg): Promise<Result>
  setViewportSize(size: { height: number; width: number }): Promise<void>
}

export interface SweepOptions {
  /** Viewport height held constant through the sweep. Defaults to `900`. */
  height?: number
  /** Widest viewport to measure. Defaults to `2560`. */
  max?: number
  /** Narrowest viewport to measure. Defaults to `320`. */
  min?: number
  /**
   * Coarse sweep step in CSS pixels. Defaults to `16`; every detected slope change
   * is then binary-searched to the exact pixel, so this only trades sweep time
   * against the chance of stepping over a very narrow band.
   */
  step?: number
}

const measure = (page: SweepablePage, selector: string): Promise<null | number> =>
  page.evaluate((target: string) => {
    const element = document.querySelector(target)
    return element ? (element as HTMLElement).getBoundingClientRect().width : null
  }, selector)

/**
 * Measures one element across a range of viewport widths.
 *
 * ```ts
 * await page.goto('http://localhost:3000/blog')
 * const samples = await sweepSizes(page, '[data-slot=card]')
 * console.log(fitSizes(samples).sizes)
 * ```
 */
export const sweepSizes = async (
  page: SweepablePage,
  selector: string,
  { height = 900, max = 2560, min = 320, step = 16 }: SweepOptions = {},
): Promise<SizeSample[]> => {
  const sampleAt = async (viewport: number): Promise<null | SizeSample> => {
    await page.setViewportSize({ height, width: viewport })
    const width = await measure(page, selector)
    return width === null ? null : { viewport, width }
  }

  const samples: SizeSample[] = []
  for (let viewport = min; viewport <= max; viewport += step) {
    const sample = await sampleAt(viewport)
    if (sample) {
      samples.push(sample)
    }
  }
  if (samples.length === 0) {
    throw new Error(
      `[payload-video-optimizer] no element matched ${JSON.stringify(selector)} at any viewport between ${min} and ${max}px. Is the page loaded, and is the slot rendered at every width?`,
    )
  }

  // The coarse pass only says a breakpoint lies somewhere inside one step. A `sizes`
  // clause wants the pixel itself, so bisect wherever three samples stop being
  // collinear, looking for the last viewport still on the earlier line.
  const onLine = (from: SizeSample, to: SizeSample, probe: SizeSample): boolean => {
    if (to.viewport === from.viewport) {
      return Math.abs(probe.width - from.width) <= COLLINEAR_TOLERANCE
    }
    const slope = (to.width - from.width) / (to.viewport - from.viewport)
    const expected = from.width + slope * (probe.viewport - from.viewport)
    return Math.abs(probe.width - expected) <= COLLINEAR_TOLERANCE
  }

  const refined = [...samples]
  for (let index = 2; index < samples.length; index++) {
    const from = samples[index - 2]
    const to = samples[index - 1]
    if (onLine(from, to, samples[index])) {
      continue
    }
    let low = to.viewport
    let high = samples[index].viewport
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      const sample = await sampleAt(middle)
      if (!sample) {
        break
      }
      refined.push(sample)
      if (onLine(from, to, sample)) {
        low = middle
      } else {
        high = middle
      }
    }
  }

  return refined.sort((a, b) => a.viewport - b.viewport)
}

/** Layout is sub-pixel, so an exact fit never happens on a real page. */
const COLLINEAR_TOLERANCE = 1.5

/**
 * Sweeps and fits in one call — the shape most callers want.
 *
 * ```ts
 * const { sizes } = await generateSizes(page, '[data-slot=card]')
 * ```
 */
export const generateSizes = async (
  page: SweepablePage,
  selector: string,
  options: SweepOptions = {},
): Promise<ReturnType<typeof fitSizes>> => fitSizes(await sweepSizes(page, selector, options))

export class SizesDriftError extends Error {
  readonly mismatches: SizesMismatch[]

  constructor(selector: string, sizes: string, mismatches: SizesMismatch[], suggestion: string) {
    const worst = mismatches[0]
    super(
      [
        `[payload-video-optimizer] the sizes string for ${JSON.stringify(selector)} no longer matches the layout.`,
        `  at ${worst.viewport}px the slot measures ${worst.measured}px, but sizes predicts ${worst.predicted}px`,
        `  → serving ${worst.would}w where ${worst.wanted}w is right (${mismatches.length} viewport/dpr combinations affected)`,
        `  current:  ${sizes}`,
        `  measured: ${suggestion}`,
      ].join('\n'),
    )
    this.name = 'SizesDriftError'
    this.mismatches = mismatches
  }
}

/**
 * Asserts a `sizes` string still describes the element — the CI gate that turns a
 * silent regression into a failing build. Change the grid to four columns, forget to
 * regenerate, and this says so instead of the video quietly going soft in production.
 *
 * ```ts
 * test('card sizes stays accurate', async ({ page }) => {
 *   await page.goto('/blog')
 *   await expectSizesAccurate(page, '[data-slot=card]', { sizes: SIZES })
 * })
 * ```
 *
 * Only differences that change which rendition is served are failures; being a few
 * pixels out inside one rung's band is harmless and is ignored.
 */
export const expectSizesAccurate = async (
  page: SweepablePage,
  selector: string,
  options: { dpr?: number[]; ladder?: number[]; sizes: string } & SweepOptions,
): Promise<void> => {
  const samples = await sweepSizes(page, selector, options)
  const ladder = options.ladder ?? DEFAULT_WIDTH_LADDER
  const dpr = options.dpr ?? [1, 2]
  const mismatches = checkSizes(parseSizes(options.sizes), samples, { dpr, ladder })
  if (mismatches.length === 0) {
    return
  }
  throw new SizesDriftError(selector, options.sizes, mismatches, fitSizes(samples).sizes)
}

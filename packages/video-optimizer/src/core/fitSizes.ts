/**
 * Turns measurements of a real element into the `sizes` string that describes it.
 *
 * Within one CSS band a slot's width is affine in viewport width — that is what
 * `width: 50%`, `max-width`, padding and gaps produce — so sweeping the viewport and
 * watching for a change in slope recovers the piecewise formula, and with it the
 * *effective* breakpoints. Those are not always the ones in the stylesheet: the
 * plateau where a `max-width` container stops growing is a breakpoint for sizing
 * purposes and appears in no media query, which is exactly the kind of thing people
 * miss when writing `sizes` by hand.
 *
 * Pure and dependency-free: measuring is the caller's job (see `./sizes-devtools`).
 */

import type { SizesClause, SlotWidth } from './sizes.js'

import { formatSizes, layoutSegments, parseSizes, solveSegment } from './sizes.js'

/** One measurement: the element's rendered width at a given viewport width. */
export interface SizeSample {
  /** Viewport width in CSS pixels. */
  viewport: number
  /** `getBoundingClientRect().width` of the slot, in CSS pixels. */
  width: number
}

export interface FitSizesOptions {
  /**
   * How much the local slope may wander before a new segment is declared. Defaults to
   * `0.02`, plus 5% of the current slope so a steep segment isn't split by rounding.
   */
  slopeTolerance?: number
  /**
   * Total width change below which a run is treated as a fixed-`px` slot rather than
   * a very shallow slope, in CSS pixels. Defaults to `1.5`.
   */
  tolerance?: number
}

export interface FitSizesResult {
  /** The parsed clauses, if you'd rather inspect than paste. */
  clauses: SizesClause[]
  /**
   * Breakpoints that came from a change in slope with no matching CSS breakpoint
   * — usually a `max-width` plateau. Worth surfacing: these are the ones a
   * hand-written `sizes` misses.
   */
  plateaus: number[]
  /** The canonical `sizes` string, ready to paste. */
  sizes: string
}

/** Common layout fractions, so `0.3333` prints as a third rather than as noise. */
const NICE_FRACTIONS = [1, 1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4, 1 / 5, 1 / 6, 1 / 8]

const snapCoefficient = (a: number): number => {
  const nearest = NICE_FRACTIONS.find((fraction) => Math.abs(fraction - a) < 0.004)
  return nearest ?? Math.round(a * 1e4) / 1e4
}

const at = ({ a, b }: SlotWidth, viewport: number): number => a * viewport + b

/** Least squares over the whole run, so no single endpoint can tilt the line. */
const fitLine = (run: SizeSample[]): SlotWidth => {
  const n = run.length
  const first = run[0]
  if (n < 2) {
    return { a: 0, b: first.width }
  }
  const meanV = run.reduce((sum, s) => sum + s.viewport, 0) / n
  const meanW = run.reduce((sum, s) => sum + s.width, 0) / n
  const variance = run.reduce((sum, s) => sum + (s.viewport - meanV) ** 2, 0)
  const covariance = run.reduce((sum, s) => sum + (s.viewport - meanV) * (s.width - meanW), 0)
  const a = variance === 0 ? 0 : covariance / variance
  return { a, b: meanW - a * meanV }
}

/**
 * Splits on a change in *slope*, not on distance from a fitted line.
 *
 * A piecewise-linear function is usually continuous at its joins — a `max-width`
 * container stops growing without jumping — so right after a bend the samples are
 * still within a pixel or two of the old line and drift away only gradually. Watching
 * the slope catches the bend at the sample it happens on; watching the deviation
 * would let the run absorb the start of the next segment and then tilt to match it.
 */
const segmentSamples = (samples: SizeSample[], slopeTolerance: number): SizeSample[][] => {
  const runs: SizeSample[][] = []
  let run: SizeSample[] = []
  let runSlope: null | number = null

  const slopeBetween = (from: SizeSample, to: SizeSample): number =>
    to.viewport === from.viewport ? 0 : (to.width - from.width) / (to.viewport - from.viewport)

  for (const sample of samples) {
    const previous = run[run.length - 1]
    if (!previous) {
      run.push(sample)
      continue
    }
    const local = slopeBetween(previous, sample)
    if (runSlope === null) {
      runSlope = local
      run.push(sample)
      continue
    }
    // Proportional as well as absolute, so a steep segment isn't split by rounding.
    if (Math.abs(local - runSlope) > slopeTolerance + 0.05 * Math.abs(runSlope)) {
      runs.push(run)
      run = [sample]
      runSlope = null
      continue
    }
    run.push(sample)
    runSlope = slopeBetween(run[0], sample)
  }
  if (run.length > 0) {
    runs.push(run)
  }
  return runs
}

/**
 * Where two adjacent segments actually meet.
 *
 * At a continuous join the exact breakpoint is where the fitted lines cross, which is
 * the only way to recover it: the samples either side agree to within a pixel there,
 * so no threshold can find it. A discontinuous join (a column count changing) has no
 * meaningful crossing — the lines meet somewhere absurd — so fall back to the first
 * sample that belongs to the new segment.
 */
const joinAt = (older: SlotWidth, newer: SlotWidth, lastOld: number, firstNew: number): number => {
  if (Math.abs(older.a - newer.a) < 1e-9) {
    return firstNew
  }
  const crossing = (newer.b - older.b) / (older.a - newer.a)
  const slack = Math.max(16, firstNew - lastOld)
  return crossing >= lastOld - slack && crossing <= firstNew + slack
    ? Math.round(crossing)
    : firstNew
}

/** Widths round up: a rounding-down error costs a rung, rounding up costs nothing. */
const widthAt = (slot: SlotWidth, viewport: number): number => Math.ceil(at(slot, viewport))

/**
 * Fits measurements to a canonical `sizes` string.
 *
 * The result describes the *layout* and nothing else — it is never fitted against a
 * rendition ladder. That is deliberate: a `sizes` string that stayed correct only for
 * the presets it was generated against would go quietly wrong the day you change
 * them, and the whole reason to paste a string rather than a resolved plan is that
 * it doesn't.
 *
 * ```ts
 * fitSizes([{ viewport: 320, width: 272 }, …]).sizes
 * // '(min-width: 1200px) 368px, (min-width: 640px) calc(50vw - 36px), calc(100vw - 48px)'
 * ```
 */
export const fitSizes = (
  samples: SizeSample[],
  { slopeTolerance = 0.02, tolerance = 1.5 }: FitSizesOptions = {},
): FitSizesResult => {
  const sorted = [...samples].sort((a, b) => a.viewport - b.viewport)
  if (sorted.length === 0) {
    throw new Error(`[payload-video-optimizer] fitSizes needs at least one measurement`)
  }

  const runs = segmentSamples(sorted, slopeTolerance)
  const lines = runs.map((run) => {
    const line = fitLine(run)
    const first = run[0]
    const last = run[run.length - 1]
    // A run that never meaningfully changes width is a fixed-px slot, not a slope.
    // A *negative* slope is one too: `sizes` has no syntax for a slot that shrinks as
    // the viewport grows, so emitting `calc(-25vw + 2000px)` produces a string this
    // module's own parser rejects — which at render time means production quietly
    // serving the master to everyone. Two samples straddling a discontinuous join
    // fit exactly that.
    if (line.a <= 0 || Math.abs(line.a) * (last.viewport - first.viewport) <= tolerance) {
      return { a: 0, b: Math.ceil(Math.max(...run.map((sample) => sample.width))) }
    }
    // Snap `a`, then put the line back through the run's centroid — otherwise the
    // snap shifts every prediction by `(a_snapped - a_fitted) x viewport`.
    const a = snapCoefficient(line.a)
    const meanV = run.reduce((sum, sample) => sum + sample.viewport, 0) / run.length
    const meanW = run.reduce((sum, sample) => sum + sample.width, 0) / run.length
    return { a, b: meanW - a * meanV }
  })

  // Widest-first, which is the order `sizes` clauses are evaluated in. The lowest
  // clause is unconditional, so its own start viewport is irrelevant.
  const clauses: SizesClause[] = lines
    .map((slot, index) => ({
      minWidth:
        index === 0
          ? 0
          : joinAt(
              lines[index - 1] as SlotWidth,
              slot,
              (runs[index - 1].at(-1) as SizeSample).viewport,
              runs[index][0].viewport,
            ),
      // Round up, since under-predicting a width costs a rung and over-predicting
      // costs nothing — but absorb float noise first, or an exact -32 fitted as
      // -31.99999 becomes -31.
      slot: { a: slot.a, b: Math.ceil(Math.round(slot.b * 1e6) / 1e6) },
    }))
    .reverse()

  const sizes = formatSizes(clauses)
  // Emitting a string this module cannot read back is the one failure that would be
  // invisible until render time, where production degrades to the original file.
  parseSizes(sizes)

  return {
    clauses,
    plateaus: clauses.flatMap((clause) =>
      clause.slot.a === 0 && clause.minWidth > 0 ? [clause.minWidth] : [],
    ),
    sizes,
  }
}

/** One viewport where the emitted string and the real layout disagree on a rung. */
export interface SizesMismatch {
  dpr: number
  measured: number
  predicted: number
  viewport: number
  /** Rendition the measurement calls for. */
  wanted: number
  /** Rendition the `sizes` string asks for. */
  would: number
}

/**
 * Checks a `sizes` string against measurements, reporting only the viewports where
 * the difference actually changes which file is served. A `sizes` that is a few
 * pixels out is harmless; one that crosses a rung boundary is not.
 */
export const checkSizes = (
  sizes: SizesClause[],
  samples: SizeSample[],
  { dpr = [1, 2], ladder }: { dpr?: number[]; ladder: number[] },
): SizesMismatch[] => {
  const segments = layoutSegments(sizes)
  const rungs = [...ladder].sort((a, b) => a - b)
  const mismatches: SizesMismatch[] = []

  for (const sample of samples) {
    const segment = segments.find((candidate) => sample.viewport >= candidate.from)
    if (!segment) {
      continue
    }
    for (const multiplier of dpr) {
      const would = solveSegment(segment, multiplier, rungs).find(
        (band) => sample.viewport >= band.minWidth,
      )?.want
      const needed = Math.ceil(sample.width) * multiplier
      const wanted = rungs.find((width) => width >= needed) ?? rungs[rungs.length - 1]
      if (would !== undefined && would !== wanted) {
        mismatches.push({
          dpr: multiplier,
          measured: Math.round(sample.width),
          predicted: widthAt(segment.slot, sample.viewport),
          viewport: sample.viewport,
          wanted,
          would,
        })
      }
    }
  }
  return mismatches
}

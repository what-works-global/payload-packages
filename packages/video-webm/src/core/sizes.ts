/**
 * Parsing and solving for the `sizes` expression `getVideoSourceSet` accepts.
 *
 * `<video>` has no `srcset`/`sizes`, so the arithmetic the browser does for `<img>`
 * — resolve the slot width against the viewport, multiply by DPR, match a candidate
 * — has to happen here instead, at render time. What that buys over asking authors
 * for viewport bands directly: the crossover between two rungs can be *solved*
 * rather than guessed, because a slot width is affine in viewport width and the
 * rungs are known.
 *
 * Deliberately dependency-free (no `payload`, no DOM) so it runs in any bundle and
 * in the dev-time tooling alike. The grammar is narrow on purpose — it is what the
 * `sizes` CLI emits — which keeps this a few regexes rather than a `calc()` parser.
 */

/** A slot width as an affine function of viewport width: `a × vw + b`, in CSS px. */
export interface SlotWidth {
  /** vw coefficient — `0.5` for `50vw`, `0` for a fixed `px` width. */
  a: number
  /** Fixed pixel offset — the `- 24px` of `calc(50vw - 24px)`. */
  b: number
}

/** One `sizes` clause: what the slot measures once this `min-width` matches. */
export interface SizesClause {
  /** `0` for the final, unconditional clause. */
  minWidth: number
  slot: SlotWidth
}

/** One `aspect` clause: the slot's shape once this `min-width` matches. */
export interface AspectClause {
  minWidth: number
  /** Width ÷ height. */
  ratio: number
}

/**
 * A stretch of the viewport axis over which both the slot formula and the slot shape
 * are constant — the merged breakpoints of `sizes` and `aspect`. Half-open
 * `[from, to)`, listed widest-first.
 */
export interface LayoutSegment {
  from: number
  ratio: null | number
  slot: SlotWidth
  to: number
}

/** One device-pixel-ratio bucket and the media query that selects it. */
export interface DprBucket {
  /** `null` on the lowest bucket, which is the fallback and carries no query. */
  minResolution: null | number
  multiplier: number
}

const fail = (message: string): never => {
  throw new Error(`[payload-video-webm] ${message}`)
}

const CONDITION = /^\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/
const LENGTH_PX = /^(\d+(?:\.\d+)?)px$/
const LENGTH_VW = /^(\d+(?:\.\d+)?)vw$/
const LENGTH_CALC = /^calc\(\s*(\d+(?:\.\d+)?)vw\s*([+-])\s*(\d+(?:\.\d+)?)px\s*\)$/
const RATIO = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/

/** `33.333vw / 100` is 0.33332999999999996 in binary floating point. */
const vwCoefficient = (percent: string): number => Math.round(Number(percent) * 1e4) / 1e6

/**
 * Splits `"(min-width: 900px) 50vw, 100vw"` into condition/value pairs. The grammar
 * contains no commas inside a value (`calc()` here only ever holds one operation),
 * so a plain split is enough and stays honest about what is supported.
 */
const splitClauses = (
  input: string,
  option: string,
): { condition: null | string; value: string }[] =>
  input
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      if (!part.startsWith('(')) {
        return { condition: null, value: part }
      }
      const close = part.indexOf(')')
      if (close === -1) {
        return fail(`${option} clause ${JSON.stringify(part)} has an unclosed media condition`)
      }
      return { condition: part.slice(0, close + 1), value: part.slice(close + 1).trim() }
    })

const parseCondition = (condition: null | string, option: string, whole: string): number => {
  if (condition === null) {
    return 0
  }
  const match = CONDITION.exec(condition)
  if (!match) {
    return fail(
      `${option} only understands \`(min-width: Npx)\` conditions, got ${JSON.stringify(condition)} in ${JSON.stringify(whole)}. Generate one with the sizes CLI, or use the array form for full control.`,
    )
  }
  return Number(match[1])
}

/**
 * First-match-wins means an ascending list serves the narrowest rule everywhere, and
 * a missing fallback leaves narrow viewports with no source at all. Both are silent
 * at runtime, so both are init errors here.
 */
const assertDescending = (clauses: { minWidth: number }[], option: string, whole: string): void => {
  for (let i = 1; i < clauses.length; i++) {
    if ((clauses[i]?.minWidth ?? 0) >= (clauses[i - 1]?.minWidth ?? 0)) {
      fail(
        `${option} clauses must be listed widest-first — the browser takes the first match, so ${JSON.stringify(whole)} would serve the narrowest rule to every viewport.`,
      )
    }
  }
  if (clauses.length > 0 && clauses[clauses.length - 1]?.minWidth !== 0) {
    fail(
      `${option} needs a final clause with no condition, as a fallback for narrow viewports — ${JSON.stringify(whole)} has none.`,
    )
  }
}

/**
 * Parses an `<img sizes>`-style string. Values may be `<N>px`, `<N>vw`, or
 * `calc(<A>vw ± <B>px)` — the canonical forms the CLI emits. Anything else throws
 * with a pointer at the tooling, rather than silently mis-sizing every video.
 */
export const parseSizes = (sizes: string): SizesClause[] => {
  const clauses = splitClauses(sizes, 'sizes').map(({ condition, value }) => {
    const minWidth = parseCondition(condition, 'sizes', sizes)

    const px = LENGTH_PX.exec(value)
    if (px) {
      return { minWidth, slot: { a: 0, b: Number(px[1]) } }
    }
    const vw = LENGTH_VW.exec(value)
    if (vw) {
      return { minWidth, slot: { a: vwCoefficient(vw[1]), b: 0 } }
    }
    const calc = LENGTH_CALC.exec(value)
    if (calc) {
      const offset = Number(calc[3]) * (calc[2] === '-' ? -1 : 1)
      return { minWidth, slot: { a: vwCoefficient(calc[1]), b: offset } }
    }
    return fail(
      `sizes value ${JSON.stringify(value)} is not one of \`Npx\`, \`Nvw\` or \`calc(Avw ± Bpx)\`. Generate the string with the sizes CLI (it converts em/rem and normalises calc), or use the array form.`,
    )
  })

  if (clauses.length === 0) {
    fail(`sizes is empty — it must describe how wide the video renders, e.g. '100vw'.`)
  }
  assertDescending(clauses, 'sizes', sizes)
  return clauses
}

/** Parses the companion `aspect` string, whose values are `W/H` or `W:H` ratios. */
export const parseAspect = (aspect: string): AspectClause[] => {
  const clauses = splitClauses(aspect, 'aspect').map(({ condition, value }) => {
    const match = RATIO.exec(value)
    const width = Number(match?.[1])
    const height = Number(match?.[2])
    if (!match || !(width > 0) || !(height > 0)) {
      return fail(`aspect value ${JSON.stringify(value)} must look like '16/9' or '9:16'.`)
    }
    return { minWidth: parseCondition(condition, 'aspect', aspect), ratio: width / height }
  })

  assertDescending(clauses, 'aspect', aspect)
  return clauses
}

/** The clause in effect at a given viewport width: the first one that matches. */
const clauseAt = <T extends { minWidth: number }>(clauses: T[], viewport: number): T | undefined =>
  clauses.find((clause) => viewport >= clause.minWidth)

/**
 * Merges the `sizes` and `aspect` breakpoints into one list of segments, so each
 * stretch of the viewport axis has a single slot formula and a single shape.
 */
export const layoutSegments = (
  sizes: SizesClause[],
  aspects: AspectClause[] = [],
): LayoutSegment[] => {
  const thresholds = [...new Set([...sizes, ...aspects].map((clause) => clause.minWidth))].sort(
    (a, b) => b - a,
  )

  return thresholds.map((from, index) => ({
    from,
    ratio: clauseAt(aspects, from)?.ratio ?? null,
    slot: clauseAt(sizes, from)?.slot ?? { a: 1, b: 0 },
    to: index === 0 ? Infinity : thresholds[index - 1],
  }))
}

/**
 * Device-pixel-ratio buckets, highest first, each with the query that selects it.
 *
 * The threshold is the **midpoint** between adjacent multipliers, not the multiplier
 * itself: `min-resolution` is a floor, so buckets round down, and gating the 2×
 * bucket at `2dppx` would drop every 1.5dppx device (Windows at 150%, much of
 * mid-range Android) to the 1× rung. Midpoints round to nearest instead, and `min-`
 * being inclusive puts exactly-1.5 in the 2× bucket where it belongs.
 *
 * The lowest bucket gets no query at all — it is the fallback, and by then every
 * higher bucket has already claimed its devices.
 */
export const dprBuckets = (dpr: number | number[]): DprBucket[] => {
  const multipliers = [...new Set(Array.isArray(dpr) ? dpr : [dpr])]
    .filter((value) => value > 0)
    .sort((a, b) => b - a)
  if (multipliers.length === 0) {
    return [{ minResolution: null, multiplier: 1 }]
  }
  return multipliers.map((multiplier, index) => {
    const below = multipliers[index + 1]
    return {
      minResolution: below === undefined ? null : (multiplier + below) / 2,
      multiplier,
    }
  })
}

/** `undefined` when unconditional, so the caller can omit `media` entirely. */
export const mediaQuery = (minWidth: number, minResolution: null | number): string | undefined => {
  const parts: string[] = []
  if (minWidth > 0) {
    parts.push(`(min-width: ${minWidth}px)`)
  }
  if (minResolution !== null) {
    parts.push(`(min-resolution: ${minResolution}dppx)`)
  }
  return parts.length > 0 ? parts.join(' and ') : undefined
}

/**
 * The viewport bands within one segment, each naming the rendition width that band
 * needs — the actual solve.
 *
 * A rung covers every viewport where `dpr × slot(vw) ≤ rung`, and `slot` is affine
 * and non-decreasing, so that set is one contiguous band per rung and the boundary
 * falls out of the inequality. Note the boundary depends only on the rung *below*
 * it, which is why a missing rung simply merges into the band above rather than
 * shifting anything.
 *
 * Returned widest-first, matching the order `<source>` elements are evaluated in.
 */
export const solveSegment = (
  segment: LayoutSegment,
  multiplier: number,
  ladder: number[],
): { minWidth: number; want: number }[] => {
  const rungs = [...new Set(ladder)].sort((a, b) => a - b)
  const largest = rungs[rungs.length - 1]
  if (largest === undefined) {
    return []
  }

  const bands: { minWidth: number; want: number }[] = []
  let cursor = segment.from
  for (const rung of rungs) {
    if (cursor >= segment.to) {
      break
    }
    // Largest viewport this rung still covers, from `multiplier × slot(vw) ≤ rung`.
    // A fixed-width slot doesn't grow, so it is covered everywhere or nowhere.
    const limit =
      segment.slot.a === 0
        ? multiplier * segment.slot.b <= rung
          ? Infinity
          : -Infinity
        : (rung / multiplier - segment.slot.b) / segment.slot.a
    if (limit < cursor) {
      continue // even the segment's narrowest viewport needs more than this rung
    }
    bands.push({ minWidth: cursor, want: rung })
    if (limit === Infinity) {
      cursor = Infinity
      break
    }
    cursor = Math.floor(limit) + 1
  }
  if (cursor < segment.to) {
    bands.push({ minWidth: cursor, want: largest }) // ladder exhausted; largest covers on
  }

  // Adjacent bands wanting the same rung (the exhausted-ladder tail, or a rung that
  // covers several bands' worth of viewport) are one band.
  const merged = bands.filter((band, index) => band.want !== bands[index - 1]?.want)
  return merged.reverse()
}

/** Renders a slot formula back to canonical `sizes` syntax. Used by the tooling. */
export const formatSlot = ({ a, b }: SlotWidth): string => {
  const round = (value: number): string => String(Math.round(value * 1000) / 1000)
  if (a === 0) {
    return `${round(b)}px`
  }
  if (b === 0) {
    return `${round(a * 100)}vw`
  }
  return `calc(${round(a * 100)}vw ${b < 0 ? '-' : '+'} ${round(Math.abs(b))}px)`
}

/** Renders parsed clauses back to a canonical `sizes` string. */
export const formatSizes = (clauses: SizesClause[]): string =>
  clauses
    .map(({ minWidth, slot }) =>
      minWidth > 0 ? `(min-width: ${minWidth}px) ${formatSlot(slot)}` : formatSlot(slot),
    )
    .join(', ')

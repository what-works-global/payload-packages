/**
 * Frontend helpers for rendering optimised videos — deliberately dependency-free
 * (no `payload` import) so they can ship in any client or server bundle.
 *
 * All of them need the `webmVersions` relationships populated with their `url`s,
 * which costs a relationship hop *beyond* the video itself: `depth: 1` when reading
 * the upload collection directly, `depth: 2` when the video is reached through
 * another document (page → media → rendition). Rows that arrive as bare ids are
 * ignored, so a too-shallow query degrades to the original file rather than
 * breaking — and says so once in development, because that is easy to miss.
 *
 * Note there is no `srcset`/`sizes` for `<video>`: browsers take the first
 * `<source>` they can play, never the best-sized one. {@link getVideoSourceSet}
 * hands the choice to the browser via `media` queries; {@link pickVideoVariant}
 * makes it from measurements you supply.
 */

import type { LayoutSegment } from '../core/sizes.js'

import {
  dprBuckets,
  layoutSegments,
  mediaQuery,
  parseAspect,
  parseSizes,
  solveSegment,
} from '../core/sizes.js'

/** The slice of a populated upload document the helpers read — structural on purpose. */
export interface VideoDocLike {
  mimeType?: null | string
  url?: null | string
  webmVersions?:
    | {
        height?: null | number
        preset?: null | string
        /** Present on rows recording a preset the job chose not to store. */
        skippedReason?: null | string
        video?: { mimeType?: null | string; url?: null | string } | null | number | string
        width?: null | number
      }[]
    | null
}

export interface VideoSource {
  /**
   * Media query for this source, set only by {@link getVideoSourceSet}. The browser
   * takes the **first** source whose query matches and whose `type` it can play.
   */
  media?: string
  /** Preset name for renditions; `null` for the original file. */
  preset: null | string
  src: string
  type: string
}

/** One stored rendition, with the dimensions the job measured off the encoded file. */
export interface VideoVariant extends VideoSource {
  /** Width ÷ height, or `null` when the encode's dimensions weren't recorded. */
  aspectRatio: null | number
  height: null | number
  preset: string
  width: null | number
}

let warnedAboutDepth = false

/**
 * Rows that exist but arrived as bare ids mean the query wasn't deep enough, and
 * every helper here would quietly fall back to the original file — the optimisation
 * silently doing nothing. Too easy to miss to stay silent about in development.
 */
const warnUnpopulated = (): void => {
  if (warnedAboutDepth) {
    return
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return
  }
  warnedAboutDepth = true
  // eslint-disable-next-line no-console
  console.warn(
    `[payload-video-webm] this document has webmVersions rows, but none are populated, so the original file will be served instead. Query one level deeper: depth 1 reading the upload collection directly, depth 2 when the video is reached through another document (page → media → rendition).`,
  )
}

const populatedRenditions = (doc: null | undefined | VideoDocLike): VideoVariant[] => {
  const rows = doc?.webmVersions
  if (!Array.isArray(rows)) {
    return []
  }
  const renditions: VideoVariant[] = []
  let unpopulated = 0
  for (const row of rows) {
    const video = row?.video
    if (!video || typeof video !== 'object' || typeof video.url !== 'string') {
      if (typeof video === 'number' || typeof video === 'string') {
        unpopulated++ // a real rendition, just not fetched deeply enough
      }
      continue // id-only, or a row recording a preset that was deliberately skipped.
    }
    const width = typeof row.width === 'number' ? row.width : null
    const height = typeof row.height === 'number' ? row.height : null
    renditions.push({
      type: typeof video.mimeType === 'string' ? video.mimeType : 'video/webm',
      aspectRatio: width && height ? width / height : null,
      height,
      preset: typeof row.preset === 'string' ? row.preset : '',
      src: video.url,
      width,
    })
  }
  if (renditions.length === 0 && unpopulated > 0) {
    warnUnpopulated()
  }
  return renditions
}

/**
 * Every stored rendition, in preset declaration (= preference) order, with its
 * measured dimensions. This is the raw material for your own picker; `getVideoSources`
 * and `pickVideoVariant` cover the common cases.
 */
export const getVideoVariants = (doc: null | undefined | VideoDocLike): VideoVariant[] =>
  populatedRenditions(doc)

/** How much `object-fit: cover` throws away fitting one aspect ratio into another. */
const overdraw = (container: number, variant: number): number =>
  container > variant ? container / variant : variant / container

/**
 * Encoded dimensions are rounded to even numbers, so rungs of the "same" shape are
 * never exactly equal — a 16:9 ladder yields 1280/720 = 1.7778 but 854/480 = 1.7792.
 * Grouping by exact ratio would split one ladder into singleton families; 5% absorbs
 * that rounding while still separating 16:9 from 16:10, 4:3, 1:1 and 9:16.
 */
const RATIO_TOLERANCE = 0.05

const sameShape = (a: number, b: number): boolean => Math.abs(a - b) <= b * RATIO_TOLERANCE

export interface PickVariantOptions {
  /** Device pixel ratio; the chosen rendition covers `width × dpr` physical pixels. */
  dpr?: number
  /** Rendered height of the slot in CSS pixels. Enables aspect-ratio selection. */
  height?: number
  /**
   * How much `cover` overdraw is tolerable before a differently-shaped rendition is
   * worth using instead. Defaults to `2` — below that, covering costs less than the
   * extra bytes of a crop.
   */
  maxOverdraw?: number
  /** Rendered width of the slot in CSS pixels. */
  width: number
}

/**
 * Picks the rendition to play in a slot of a given size — the plan every responsive
 * `<video>` needs, without shipping you a component to fight with:
 *
 * ```tsx
 * const variant = pickVideoVariant(media, { dpr: devicePixelRatio, height, width })
 * <video src={variant?.src ?? media.url} />
 * ```
 *
 * Shape is decided first: the primary (first-declared) family wins unless covering
 * with it would overdraw more than `maxOverdraw`, in which case the closest-shaped
 * family is used — that's the portrait-crop case. Then, within that family, the
 * smallest rendition at least as wide as `width × dpr` is chosen, falling back to the
 * largest one when the slot outgrows the ladder. Returns `null` when nothing is
 * stored yet, so callers fall back to the source.
 */
const selectFamily = (
  variants: VideoVariant[],
  containerRatio: null | number,
  maxOverdraw: number,
): VideoVariant[] => {
  const shaped = variants.filter((variant) => variant.aspectRatio !== null)
  const primary = shaped[0]?.aspectRatio ?? null
  if (primary === null) {
    return variants
  }
  // Without a slot shape the primary family stands: a crop is *different framing*,
  // never a stand-in for a wider file.
  const closest = shaped.reduce((a, b) =>
    containerRatio !== null &&
    overdraw(containerRatio, b.aspectRatio!) < overdraw(containerRatio, a.aspectRatio!)
      ? b
      : a,
  )
  const family =
    containerRatio !== null && overdraw(containerRatio, primary) > maxOverdraw
      ? closest.aspectRatio!
      : primary
  return shaped.filter((variant) => sameShape(variant.aspectRatio!, family))
}

/** Smallest rendition covering `needed` physical pixels; the largest if none does. */
const coveringVariant = (candidates: VideoVariant[], needed: number): null | VideoVariant => {
  const sized = [...candidates].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return sized.find((variant) => (variant.width ?? 0) >= needed) ?? sized.at(-1) ?? null
}

export const pickVideoVariant = (
  doc: null | undefined | VideoDocLike,
  { dpr = 1, height, maxOverdraw = 2, width }: PickVariantOptions,
): null | VideoVariant => {
  const variants = populatedRenditions(doc)
  if (variants.length === 0) {
    return null
  }
  const containerRatio = height && height > 0 ? width / height : null
  return coveringVariant(selectFamily(variants, containerRatio, maxOverdraw), width * dpr)
}

export interface VideoSizeRule {
  /** Rendered height of the slot; enables shape selection. */
  height?: number
  /** Full media query (`'(orientation: portrait)'`). Takes precedence over `minWidth`. */
  media?: string
  /** Shorthand for `(min-width: Npx)`. Omit on the final, unconditional rule. */
  minWidth?: number
  /** Rendered width of the slot in CSS pixels when this rule applies. */
  width: number
}

export interface SourceSetOptions {
  /**
   * The slot's *shape*, in the same grammar as `sizes`, with `W/H` ratio values:
   * `'(min-width: 768px) 16/9, 9/16'`. Only needed when a slot changes shape and you
   * have cropped renditions for it (see the plugin's `portrait` option) — without it
   * every band stays on the source's own framing.
   */
  aspect?: string
  /**
   * Device pixel ratios to emit sources for. Defaults to `[1, 2]`, which serves a 1×
   * display the file it can actually show instead of one at four times the bytes,
   * and a 2× display a file that isn't soft. A single number reproduces the old
   * behaviour: one assumed ratio, no resolution queries.
   */
  dpr?: number | number[]
  /**
   * How wide the video renders. Either an `<img sizes>`-style string (recommended —
   * generate it with the `sizes` CLI), or the explicit rule array.
   */
  sizes: string | VideoSizeRule[]
}

/**
 * Builds a `<source>` list with `media` queries, so the **browser** picks the
 * rendition and no JavaScript is involved:
 *
 * ```tsx
 * <video controls>
 *   {getVideoSourceSet(media, { sizes: '(min-width: 1280px) 800px, 100vw' }).map(
 *     ({ media: query, src, type }) => (
 *       <source key={src + query} media={query} src={src} type={type} />
 *     ),
 *   )}
 * </video>
 * ```
 *
 * `sizes` says how wide the video renders — the same thing `<img sizes>` says, and
 * for the same reason: nothing in the markup tells the browser how your CSS lays the
 * page out. It is the *only* thing you supply. Device pixel ratio is handled for you.
 *
 * Given the slot formula and the document's own rendition widths, every crossover is
 * solved rather than guessed, so the emitted breakpoints land exactly where one rung
 * stops being enough — including breakpoints that appear nowhere in your stylesheet,
 * like the plateau where a `max-width` container stops growing.
 *
 * The trade-off against {@link pickVideoVariant}: this needs no client JavaScript and
 * survives static rendering, but browsers evaluate video sources **once, at load** —
 * they do not swap on resize or rotation the way `<picture>` does.
 */
export const getVideoSourceSet = (
  doc: null | undefined | VideoDocLike,
  { aspect, dpr = [1, 2], sizes }: SourceSetOptions,
): VideoSource[] => {
  const variants = populatedRenditions(doc)
  const sources: VideoSource[] =
    typeof sizes === 'string'
      ? fromSizesString(variants, sizes, aspect, dpr)
      : fromRuleArray(variants, sizes, dpr)

  warnIfUnladdered(variants, sources)
  if (doc && typeof doc.url === 'string') {
    sources.push({
      type: typeof doc.mimeType === 'string' ? doc.mimeType : 'video/mp4',
      preset: null,
      src: doc.url,
    })
  }
  return sources
}

/** Solves the whole viewport axis per DPR bucket, widest band first. */
const fromSizesString = (
  variants: VideoVariant[],
  sizes: string,
  aspect: string | undefined,
  dpr: number | number[],
): VideoSource[] => {
  let segments: LayoutSegment[]
  try {
    segments = layoutSegments(parseSizes(sizes), aspect ? parseAspect(aspect) : [])
  } catch (error) {
    // A bad string must not blank the video in production; the original still plays.
    if (isDevelopment()) {
      throw error
    }
    return []
  }
  if (variants.length === 0) {
    return []
  }

  const buckets = dprBuckets(dpr).map((bucket) => {
    const sources: VideoSource[] = []
    for (const segment of segments) {
      const family = selectFamily(variants, segment.ratio, DEFAULT_MAX_OVERDRAW)
      const ladder = family.flatMap((variant) => (variant.width ? [variant.width] : []))
      for (const band of solveSegment(segment, bucket.multiplier, ladder)) {
        const variant = coveringVariant(family, band.want)
        if (variant) {
          push(sources, variant, mediaQuery(band.minWidth, bucket.minResolution))
        }
      }
    }
    return sources
  })

  warnIfAspectUnmatched(variants, segments, aspect)
  return flatten(buckets)
}

/** The explicit form: one entry per rule, crossed with the DPR buckets. */
const fromRuleArray = (
  variants: VideoVariant[],
  rules: VideoSizeRule[],
  dpr: number | number[],
): VideoSource[] => {
  warnIfAscending(rules)

  const buckets = dprBuckets(dpr).map((bucket) => {
    const sources: VideoSource[] = []
    for (const rule of rules) {
      const containerRatio = rule.height && rule.height > 0 ? rule.width / rule.height : null
      const family = selectFamily(variants, containerRatio, DEFAULT_MAX_OVERDRAW)
      const variant = coveringVariant(family, rule.width * bucket.multiplier)
      if (!variant) {
        continue
      }
      const width = rule.media ?? (rule.minWidth ? `(min-width: ${rule.minWidth}px)` : undefined)
      const resolution =
        bucket.minResolution === null ? undefined : `(min-resolution: ${bucket.minResolution}dppx)`
      push(sources, variant, [width, resolution].filter(Boolean).join(' and ') || undefined)
    }
    return sources
  })

  return flatten(buckets)
}

const push = (sources: VideoSource[], variant: VideoVariant, media: string | undefined): void => {
  sources.push({
    type: variant.type,
    ...(media ? { media } : {}),
    preset: variant.preset,
    src: variant.src,
  })
}

/**
 * Flattens the per-bucket lists, dropping noise two ways.
 *
 * Within a bucket, entries descend by `min-width` under one resolution query, so
 * anything matching an entry also matches the next — a duplicate `src` there can only
 * ever serve what the following rule serves anyway. Across buckets that reasoning
 * fails (a high-DPR device matching the last entry of its bucket need not match the
 * first, narrower entry of the next), so the only safe cross-bucket collapse is
 * dropping a bucket that is identical to the one after it.
 */
const flatten = (buckets: VideoSource[][]): VideoSource[] => {
  const trimmed = buckets.map((bucket) =>
    bucket.filter((source, index) => source.src !== bucket[index + 1]?.src),
  )
  const RESOLUTION = /\s*(?:and\s*)?\(min-resolution[^)]*\)/g
  const key = (bucket: VideoSource[]): string =>
    bucket
      .map((source) => `${source.media?.replace(RESOLUTION, '').trim() ?? ''}|${source.src}`)
      .join(';')

  return trimmed.filter((bucket, index) => key(bucket) !== key(trimmed[index + 1] ?? [])).flat()
}

const DEFAULT_MAX_OVERDRAW = 2

const isDevelopment = (): boolean =>
  typeof process === 'undefined' || process.env?.NODE_ENV !== 'production'

let warnedAboutOrder = false

/** First match wins, so ascending `minWidth` rules would serve the smallest file everywhere. */
let warnedAboutLadder = false

/**
 * Selection needs something to select between. With one rendition every band resolves
 * to the same file, which looks like it works and quietly does nothing.
 */
const warnIfUnladdered = (variants: VideoVariant[], sources: VideoSource[]): void => {
  if (warnedAboutLadder || variants.length === 0 || sources.length > 1 || !isDevelopment()) {
    return
  }
  warnedAboutLadder = true
  // eslint-disable-next-line no-console
  console.warn(
    `[payload-video-webm] this document has ${variants.length === 1 ? 'only one rendition' : 'no usable renditions'}, so every viewport gets the same file and sizes has nothing to choose between. Configure a ladder (the default \`widthPresets()\`) and regenerate.`,
  )
}

let warnedAboutAspect = false

/** An `aspect` naming a shape you never encoded is a silent no-op otherwise. */
const warnIfAspectUnmatched = (
  variants: VideoVariant[],
  segments: LayoutSegment[],
  aspect: string | undefined,
): void => {
  if (warnedAboutAspect || !aspect || !isDevelopment()) {
    return
  }
  const shapes = new Set(variants.flatMap((v) => (v.aspectRatio === null ? [] : [v.aspectRatio])))
  const unmatched = segments
    .map((segment) => segment.ratio)
    .filter(
      (ratio): ratio is number =>
        ratio !== null && ![...shapes].some((shape) => sameShape(ratio, shape)),
    )
  if (unmatched.length === 0) {
    return
  }
  warnedAboutAspect = true
  // eslint-disable-next-line no-console
  console.warn(
    `[payload-video-webm] aspect ${JSON.stringify(aspect)} asks for a shape this document has no renditions in, so it changes nothing. Encode one with the plugin's \`portrait\` option (or widthPresets with an aspectRatio).`,
  )
}

const warnIfAscending = (sizes: VideoSizeRule[]): void => {
  if (warnedAboutOrder) {
    return
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return
  }
  const widths = sizes.flatMap((rule) => (!rule.media && rule.minWidth ? [rule.minWidth] : []))
  if (
    widths.length < 2 ||
    widths.every((width, index) => index === 0 || widths[index - 1] > width)
  ) {
    return
  }
  warnedAboutOrder = true
  // eslint-disable-next-line no-console
  console.warn(
    `[payload-video-webm] getVideoSourceSet was given ascending minWidth rules. The browser takes the first source whose media query matches, so list the widest breakpoint first or every viewport will get the smallest rendition.`,
  )
}

/**
 * URL of one optimised rendition, or `null` when it doesn't exist (yet). With no
 * `preset` argument, returns the most-preferred rendition (first in the preset
 * declaration order). Always pair with a fallback to the source:
 *
 * ```tsx
 * <video controls src={getWebmUrl(media, '720p') ?? media.url ?? undefined} />
 * ```
 */
export const getWebmUrl = (
  doc: null | undefined | VideoDocLike,
  preset?: string,
): null | string => {
  const renditions = populatedRenditions(doc)
  const match = preset ? renditions.find((r) => r.preset === preset) : renditions[0]
  return match?.src ?? null
}

/**
 * The full `<source>` list for a `<video>` element: every populated rendition in
 * preference order, then the original file as the guaranteed fallback — browsers
 * pick the first source they can play, so this always plays *something*:
 *
 * ```tsx
 * <video controls>
 *   {getVideoSources(media).map((s) => (
 *     <source key={s.src} src={s.src} type={s.type} />
 *   ))}
 * </video>
 * ```
 *
 * Pass `presets` to restrict and re-order the renditions (e.g. `['720p', '360p']`
 * for a small player); the original fallback is always appended.
 */
export const getVideoSources = (
  doc: null | undefined | VideoDocLike,
  options: { presets?: string[] } = {},
): VideoSource[] => {
  const renditions = populatedRenditions(doc)
  const ordered = options.presets
    ? options.presets.flatMap((name) => renditions.filter((r) => r.preset === name))
    : renditions

  const sources: VideoSource[] = ordered.map((r) => ({
    type: r.type,
    preset: r.preset || null,
    src: r.src,
  }))

  if (doc && typeof doc.url === 'string') {
    sources.push({
      type: typeof doc.mimeType === 'string' ? doc.mimeType : 'video/mp4',
      preset: null,
      src: doc.url,
    })
  }

  return sources
}

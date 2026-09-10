import type {
  ResolvedPreset,
  ResolvedVideoOptimizerConfig,
  VideoEncodingOptions,
  VideoOptimizerCollectionOverrides,
  VideoOptimizerConfig,
  VideoPreset,
} from '../types.js'
import type { RuntimeInfo } from './runtime.js'

import { parseAspectRatio } from './args.js'

/**
 * Video mime types converted by default — the common non-WebM containers browsers
 * and phones actually produce. `video/webm` is intentionally absent (nothing to do)
 * and is guarded against separately even when a custom list includes it.
 */
export const DEFAULT_INPUT_MIME_TYPES = [
  'video/3gpp',
  'video/mp4',
  'video/mpeg',
  'video/ogg',
  'video/quicktime',
  'video/x-flv',
  'video/x-m4v',
  'video/x-matroska',
  'video/x-ms-wmv',
  'video/x-msvideo',
]

export const WEBM_MIME_TYPE = 'video/webm'

export const DEFAULT_TASK_SLUG = 'video-convert'

export const DEFAULT_QUEUE = 'video-conversion'

/**
 * Payload's own default is no retries, and cron only picks up jobs that are still
 * runnable — an unretried first failure would be terminal.
 */
export const DEFAULT_RETRIES = 3

/**
 * Safe-by-default cap on simultaneous ffmpeg processes. VP9 encoding saturates
 * several cores per encode, so unlimited concurrency can starve a small deployment;
 * `maxConcurrentEncodes: null` opts back into unlimited.
 */
export const DEFAULT_MAX_CONCURRENT_ENCODES = 2

/**
 * Google's published VP9 VOD constant-quality recommendations, by frame height.
 * Heights are 16:9, which is how the table is published.
 */
const LADDER_CRF: Record<number, number> = {
  144: 40,
  240: 37,
  360: 36,
  480: 33,
  720: 32,
  1080: 31,
  1440: 24,
  2160: 15,
}

/**
 * Ready-made quality ladder: one preset per height (`'720p'` → `maxHeight: 720`)
 * with Google's recommended VP9 CRF for that resolution, never upscaling. Pass the
 * result to `presets`, spread it to tweak, or add your own alongside:
 *
 * ```ts
 * presets: resolutionPresets([360, 720, 1080])
 * ```
 */
export const resolutionPresets = (
  heights: number[] = [360, 720, 1080],
): Record<string, VideoPreset> =>
  Object.fromEntries(
    heights.map((height) => [
      `${height}p`,
      {
        encoding: { crf: LADDER_CRF[height] ?? 32, maxHeight: height },
        label: `${height}p`,
      } satisfies VideoPreset,
    ]),
  )

/**
 * A width ladder spaced ~1.5× apart. File size tracks pixel count and pixel count is
 * width squared, so each rung is roughly half the bytes of the one above it: close
 * enough that no request is served a badly oversized file, far enough apart that the
 * extra encodes earn their keep.
 *
 * The default covers every slot a 1440px laptop at 2× can produce, from thumbnail to
 * full-bleed hero.
 */
export const DEFAULT_WIDTH_LADDER = [2560, 1920, 1280, 854, 640, 426]

/**
 * The same table keyed by pixel count instead of height. Quality should follow how
 * many pixels a rung actually has, not how tall it would be if it were 16:9 — a 9:16
 * crop 1080px wide is 1080×1920, the same 2.07 MP as a 1920×1080 landscape rung, and
 * belongs at the same CRF rather than being judged as a 608px-tall thumbnail.
 */
const CRF_BY_PIXELS = Object.entries(LADDER_CRF)
  .map(([height, crf]) => ({ crf, pixels: Number(height) * Number(height) * (16 / 9) }))
  .sort((a, b) => a.pixels - b.pixels)

/**
 * Nearest tier in log space, so a width that falls between two rungs picks whichever
 * it is proportionally closer to rather than always rounding one way.
 */
const crfForPixels = (pixels: number): number =>
  CRF_BY_PIXELS.reduce((best, tier) =>
    Math.abs(Math.log(tier.pixels / pixels)) < Math.abs(Math.log(best.pixels / pixels))
      ? tier
      : best,
  ).crf

/** `'9:16'` → `'9x16'`: preset keys become filenames, so `:` and `/` can't survive. */
const ratioSlug = (ratio: string): string => ratio.replace(/\s+/g, '').replace(/[:/]/g, 'x')

/**
 * Width-based ladder: one preset per width, capped so nothing is ever upscaled, with
 * each rung's CRF taken from the resolution table by pixel count. Widths suit layout
 * work better than heights — a slot is measured by how wide it is.
 *
 * ```ts
 * presets: {
 *   ...widthPresets(),                                    // 2560w … 426w
 *   ...widthPresets([1080, 720], { aspectRatio: '9:16' }), // 9x16-1080w, 9x16-720w
 * }
 * ```
 *
 * With `aspectRatio` the rungs are cropped to that shape first (positioned by the
 * document's focal point), which is the one case worth a separate encode: `cover` on
 * a landscape master in a 9:16 slot downloads roughly 3× the pixels it shows. Prefer
 * the `portrait` plugin option to spelling that out.
 */
export const widthPresets = (
  widths: number[] = DEFAULT_WIDTH_LADDER,
  options: { aspectRatio?: string; prefix?: string } = {},
): Record<string, VideoPreset> => {
  // Without a prefix a cropped ladder collides key-for-key with the landscape one
  // (`1080w` twice), and the later spread silently wins. Derive one from the ratio.
  const prefix =
    options.prefix ?? (options.aspectRatio ? ratioSlug(options.aspectRatio) : undefined)
  const ratio = (options.aspectRatio ? parseAspectRatio(options.aspectRatio) : null) ?? 16 / 9

  return Object.fromEntries(
    widths.map((width) => {
      const name = prefix ? `${prefix}-${width}w` : `${width}w`
      return [
        name,
        {
          encoding: {
            ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
            crf: crfForPixels((width * width) / ratio),
            maxWidth: width,
          },
          label: prefix ? `${prefix} ${width}px` : `${width}px`,
        } satisfies VideoPreset,
      ]
    }),
  )
}

/**
 * The default renditions: the full width ladder. Encode cost tracks pixel count, so
 * the small rungs are nearly free (`426w` is ~1% of a 4K encode) and the whole ladder
 * still costs *less* than one uncapped source-resolution encode of a 4K master —
 * which is what a single-rendition default would do, most phone footage now being 4K.
 * `skipRedundantPresets` trims the rungs a smaller source can't fill.
 */
export const DEFAULT_PRESETS: Record<string, VideoPreset> = widthPresets()

/** Widths used by `portrait: true`. 1080×1920 and 720×1280 — phone-hero sizes. */
export const DEFAULT_PORTRAIT_WIDTHS = [1080, 720]

/** The one aspect ratio that reliably earns its own encode. See `portrait`. */
export const PORTRAIT_ASPECT_RATIO = '9:16'

const fail = (message: string): never => {
  throw new Error(`[payload-video-optimizer] ${message}`)
}

const assertIntegerInRange = (value: number, min: number, max: number, name: string): void => {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer between ${min} and ${max}, got ${value}`)
  }
}

const assertPositiveInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer, got ${value}`)
  }
}

/**
 * Preset encoding over collection encoding — except the dimension caps, which
 * *intersect*.
 *
 * A plain spread makes a house cap meaningless the moment a preset sets its own,
 * and every rung of every ladder builder sets `maxWidth`. So `encoding: { maxWidth:
 * 1920 }` alongside the default presets used to be a silent no-op, with `2560w`
 * still emitting 2560. A cap that only sometimes caps is worse than no cap.
 */
const mergeEncoding = (
  base: VideoEncodingOptions,
  preset: undefined | VideoEncodingOptions,
): VideoEncodingOptions => {
  const tightest = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.min(a, b)

  return {
    ...base,
    ...preset,
    maxHeight: tightest(base.maxHeight, preset?.maxHeight),
    maxWidth: tightest(base.maxWidth, preset?.maxWidth),
  }
}

/** `quality` as a CRF delta. Lower CRF is better quality and a larger file. */
const QUALITY_CRF_OFFSET = { balanced: 0, high: -4, small: 4 } as const

/**
 * `quality` shifts every rung rather than flattening the ladder to one number, so
 * the per-resolution tuning survives. Warns rather than throws when combined with an
 * explicit `encoding.crf`, since the combination is coherent — just rarely intended.
 */
const resolveQualityOffset = (pluginConfig: VideoOptimizerConfig): number =>
  QUALITY_CRF_OFFSET[pluginConfig.quality ?? 'balanced']

/** `presets` with the 9:16 rungs appended when `portrait` asks for them. */
const withPortrait = (pluginConfig: VideoOptimizerConfig): Record<string, VideoPreset> => {
  const presets = pluginConfig.presets ?? DEFAULT_PRESETS
  if (!pluginConfig.portrait) {
    return presets
  }
  const widths =
    (pluginConfig.portrait === true ? undefined : pluginConfig.portrait.widths) ??
    DEFAULT_PORTRAIT_WIDTHS
  return {
    ...presets,
    ...widthPresets(widths, { aspectRatio: PORTRAIT_ASPECT_RATIO, prefix: 'portrait' }),
  }
}

/**
 * Applies defaults and validates one encoding block — the ranges ffmpeg would
 * otherwise reject with an opaque encoder error mid-job. `context` names the
 * offending option in errors (`encoding` or `presets.<name>.encoding`).
 */
const resolveEncoding = (
  encoding: VideoEncodingOptions,
  context: string,
  crfOffset = 0,
): ResolvedVideoOptimizerConfig['encoding'] => {
  const codec = encoding.codec ?? 'vp9'
  const declaredCrf = encoding.crf ?? 32
  const speed = encoding.speed ?? 2

  // TS narrows codec to the union, but a typo'd value from untyped config would
  // otherwise silently select VP8 in buildFfmpegArgs.
  if (codec !== 'vp8' && codec !== 'vp9') {
    fail(`${context}.codec must be 'vp8' or 'vp9', got ${JSON.stringify(codec)}`)
  }
  // Validate what the author wrote, then clamp — otherwise `quality: 'small'` on the
  // 2160p rung (crf 15) could leave the range, and a typo'd crf 64 would be silently
  // clamped into validity instead of failing at init.
  assertIntegerInRange(declaredCrf, 0, 63, `${context}.crf`)
  const crf = Math.min(63, Math.max(0, declaredCrf + crfOffset))
  // VP9's `good` deadline caps -cpu-used at 5; VP8 accepts up to 16.
  assertIntegerInRange(speed, 0, codec === 'vp9' ? 5 : 16, `${context}.speed`)
  if (encoding.maxWidth !== undefined) {
    assertPositiveInteger(encoding.maxWidth, `${context}.maxWidth`)
  }
  if (encoding.maxHeight !== undefined) {
    assertPositiveInteger(encoding.maxHeight, `${context}.maxHeight`)
  }
  if (encoding.aspectRatio !== undefined && parseAspectRatio(encoding.aspectRatio) === null) {
    fail(
      `${context}.aspectRatio must look like 'W:H' with positive numbers, got ${JSON.stringify(encoding.aspectRatio)}`,
    )
  }

  return {
    aspectRatio: encoding.aspectRatio,
    audio: encoding.audio !== false,
    audioBitrate: encoding.audioBitrate ?? '128k',
    codec,
    crf,
    extraArgs: encoding.extraArgs ?? [],
    maxHeight: encoding.maxHeight,
    maxWidth: encoding.maxWidth,
    pixelFormat: encoding.pixelFormat === undefined ? 'yuv420p' : encoding.pixelFormat,
    speed,
    videoBitrate: encoding.videoBitrate ?? (codec === 'vp9' ? '0' : '1M'),
  }
}

/** Preset keys land in filenames (`clip-720p.webm`), so keep them path-safe. */
const PRESET_NAME_PATTERN = /^[\w-]{1,32}$/

/**
 * Applies defaults and validates the whole plugin/collection config, presets
 * included. Throws at plugin init, not upload time.
 */
export const resolveConfig = (pluginConfig: VideoOptimizerConfig): ResolvedVideoOptimizerConfig => {
  // Derived rather than fixed: the documented chunking budget is shorter than the
  // default timeout, so a fixed default made every chunking setup warn at every boot
  // about a conflict it had not chosen.
  const maxRunMs = pluginConfig.jobs?.maxRunMs ?? null
  if (maxRunMs !== null) {
    // Before the timeout is derived from it, or an invalid budget is reported as an
    // invalid timeout.
    assertPositiveInteger(maxRunMs, 'jobs.maxRunMs')
  }
  // A per-encode timeout is only ever a proxy for the host's own execution limit, so
  // it defaults to that limit and to nothing when there isn't one. The old fixed
  // 10-minute default capped the very deployment meant to escape those limits — a
  // 30-minute source's `1920w` rung wants over an hour on an 8-core worker — while
  // also binding *before* a 30-minute serverless function did.
  const timeoutMs =
    pluginConfig.ffmpeg?.timeoutMs === undefined ? maxRunMs : pluginConfig.ffmpeg.timeoutMs
  const maxInputFileSize = pluginConfig.maxInputFileSize ?? null
  const retries = pluginConfig.jobs?.retries ?? DEFAULT_RETRIES
  // undefined → the safe default; an explicit null opts into unlimited.
  const maxConcurrentEncodes =
    pluginConfig.ffmpeg?.maxConcurrent === undefined
      ? DEFAULT_MAX_CONCURRENT_ENCODES
      : pluginConfig.ffmpeg.maxConcurrent

  if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    fail(`ffmpeg.timeoutMs must be a positive number of milliseconds or null, got ${timeoutMs}`)
  }
  if (maxInputFileSize !== null) {
    assertPositiveInteger(maxInputFileSize, 'maxInputFileSize')
  }
  if (maxConcurrentEncodes !== null) {
    assertPositiveInteger(maxConcurrentEncodes, 'ffmpeg.maxConcurrent')
  }
  if (!Number.isInteger(retries) || retries < 0) {
    fail(`jobs.retries must be a non-negative integer, got ${retries}`)
  }

  const baseEncoding = pluginConfig.encoding ?? {}
  const crfOffset = resolveQualityOffset(pluginConfig)
  const presetEntries = Object.entries(withPortrait(pluginConfig))
  if (presetEntries.length === 0) {
    fail(`presets must define at least one rendition`)
  }
  const presets: Record<string, ResolvedPreset> = {}
  for (const [name, preset] of presetEntries) {
    if (!PRESET_NAME_PATTERN.test(name)) {
      fail(
        `preset name ${JSON.stringify(name)} is invalid — names become filename suffixes, use 1-32 letters, digits, underscores or dashes`,
      )
    }
    presets[name] = {
      encoding: resolveEncoding(
        mergeEncoding(baseEncoding, preset.encoding),
        `presets.${name}.encoding`,
        crfOffset,
      ),
      label: preset.label ?? name,
    }
  }

  return {
    encoding: resolveEncoding(baseEncoding, 'encoding'),
    fetchSource: pluginConfig.fetchSource ?? null,
    ffmpegPath: pluginConfig.ffmpeg?.path ?? process.env.FFMPEG_PATH ?? 'ffmpeg',
    inputMimeTypes: pluginConfig.inputMimeTypes ?? DEFAULT_INPUT_MIME_TYPES,
    maxConcurrentEncodes,
    maxInputFileSize,
    maxRunMs,
    metadataFields: pluginConfig.metadataFields !== false,
    onConversionComplete: pluginConfig.onConversionComplete ?? null,
    presets,
    shouldConvert: pluginConfig.shouldConvert ?? null,
    skipIfLarger: pluginConfig.skipIfLarger !== false,
    skipRedundantPresets: pluginConfig.skipRedundantPresets !== false,
    timeoutMs,
  }
}

/**
 * What a run should do with the next preset, given its time budget.
 *
 * `skip` and `defer` look similar and are not: a preset projected past a *whole*
 * budget can never finish in any chunk, so recording the decision beats burning
 * retries rediscovering it. One that merely doesn't fit what's *left* is fine — a
 * later chunk gets it with a full budget.
 *
 * `forced` guarantees forward progress. Without it a budget smaller than a single
 * encode defers everything, every chunk, forever.
 */
export const budgetDecision = ({
  budgetLeftMs,
  budgetMs,
  forced,
  projectedMs,
}: {
  budgetLeftMs: number
  budgetMs: null | number
  forced: boolean
  projectedMs: null | number
}): 'defer' | 'encode' | 'skip' => {
  if (budgetMs === null || forced) {
    return 'encode'
  }
  if (projectedMs !== null && projectedMs > budgetMs) {
    return 'skip'
  }
  // Starting an encode on a sliver of budget just buys a clamped timeout and a
  // certain failure, which spends a retry to learn nothing. Defer instead — the
  // next chunk gets the whole budget.
  if (budgetLeftMs < budgetMs * MIN_BUDGET_FRACTION) {
    return 'defer'
  }
  if (projectedMs !== null && projectedMs > budgetLeftMs) {
    return 'defer'
  }
  return 'encode'
}

/** Below this share of the budget, don't start another preset. */
const MIN_BUDGET_FRACTION = 0.15

/**
 * The frame size a preset will actually produce from a given source: cropped to its
 * aspect ratio if it has one, then scaled down to fit its caps, never upscaled.
 *
 * Used to project encode cost, which tracks pixel count — so a rung's cost can be
 * estimated from a completed rung's measured throughput without encoding it first.
 */
export const outputDimensions = (
  preset: ResolvedPreset,
  source: { height: number; width: number },
): { height: number; width: number } => {
  const { aspectRatio, maxHeight, maxWidth } = preset.encoding
  const ratio = aspectRatio ? parseAspectRatio(aspectRatio) : null
  const cropped =
    ratio === null
      ? source
      : {
          height: Math.min(source.height, source.width / ratio),
          width: Math.min(source.width, source.height * ratio),
        }

  const scale = Math.min(
    1,
    maxWidth === undefined ? 1 : maxWidth / cropped.width,
    maxHeight === undefined ? 1 : maxHeight / cropped.height,
  )
  return { height: cropped.height * scale, width: cropped.width * scale }
}

/**
 * Configuration that is valid but almost certainly not what was meant. Returned
 * rather than logged so the plugin can put them through the app's own logger, once,
 * instead of `console.warn` per targeted collection.
 */
export const configWarnings = (
  pluginConfig: VideoOptimizerConfig,
  resolved: ResolvedVideoOptimizerConfig,
  context: { hasQueueDrainer: boolean; queue: string; runtime?: RuntimeInfo },
): string[] => {
  const warnings: string[] = []
  const presets = Object.entries(withPortrait(pluginConfig))

  if (
    pluginConfig.encoding?.crf !== undefined &&
    presets.length > 0 &&
    presets.every(([, preset]) => preset.encoding?.crf !== undefined)
  ) {
    warnings.push(
      `encoding.crf is set but every preset declares its own, so it has no effect. Use quality: 'high' | 'small' to shift the whole ladder, or set crf on the presets themselves.`,
    )
  }
  if (pluginConfig.quality && pluginConfig.quality !== 'balanced' && pluginConfig.encoding?.crf) {
    warnings.push(
      `both quality: '${pluginConfig.quality}' and encoding.crf are set — the offset applies on top of whichever crf ends up in effect. Set one or the other.`,
    )
  }
  const runtime = context.runtime ?? { name: null, kind: 'node' as const }
  if (runtime.kind === 'cloudflare-workers') {
    // Not a configuration problem, so it is stated as a fact rather than a fix:
    // Workers is a V8 isolate with no child_process and no filesystem, so ffmpeg
    // cannot be executed there at any budget.
    warnings.push(
      `running on ${runtime.name}, which cannot execute ffmpeg — there is no child_process and no writable filesystem, so every conversion will fail at spawn. Run the "${context.queue}" queue on a Node host instead (a payload jobs:run container), pointed at the same database.`,
    )
  } else if (runtime.kind === 'serverless' && resolved.maxRunMs === null) {
    // The worst outcome the plugin has, reached by writing no config at all. Without
    // a budget the ladder runs widest-first and nothing bounds an encode, so the
    // platform kills the invocation mid-rung: no document write, orphaned sidecars,
    // and retries that repeat it. With a budget the same source degrades a rung at a
    // time and keeps what it finished.
    warnings.push(
      `running on ${runtime.name} but jobs.maxRunMs is not set, so a conversion that outlives the function is killed mid-encode — nothing is linked, the finished renditions are orphaned, and each retry starts over. Set jobs.maxRunMs below your function's maxDuration to encode smallest-first and keep what fits.`,
    )
  }
  if (
    resolved.maxRunMs !== null &&
    resolved.timeoutMs !== null &&
    resolved.timeoutMs > resolved.maxRunMs
  ) {
    warnings.push(
      `ffmpeg.timeoutMs (${resolved.timeoutMs}) is longer than jobs.maxRunMs (${resolved.maxRunMs}), so no encode could ever use it — each one is capped at what remains of the budget.`,
    )
  }
  // Not gated on maxRunMs: `runByID` runs a job once, so without something polling
  // for runnable rows a failed conversion is never retried whatever the config, and
  // the default `retries: 3` quietly means nothing.
  if (!context.hasQueueDrainer) {
    warnings.push(
      `nothing appears to drain the "${context.queue}" queue, so a failed conversion will never be retried${resolved.maxRunMs !== null ? ', and a chunked conversion that loses its continue request will never resume' : ''}. Add jobs.autoRun for that queue, an external cron hitting /api/payload-jobs/run, or a payload jobs:run worker.`,
    )
  }
  return warnings
}

/**
 * Presets that would only duplicate an earlier rendition because the source is too
 * small to fill them. Nothing is ever upscaled, so every rung whose cap sits at or
 * above the source encodes the *same* frame size: the first of them is the
 * full-size rendition and the rest are copies of it.
 *
 * Cropped presets are judged against the crop window rather than the whole frame — a
 * 9:16 window out of a 1920×1080 master is only 607px wide, so a 1080px-wide portrait
 * rung is already full size. Each aspect ratio keeps its own full-size rung, and
 * uncapped presets never take part since they may differ by CRF alone.
 *
 * The rung kept is the one whose cap fits the source most tightly: every full-size
 * rung yields the same pixels, so keeping `1280w` over `1920w` for a 1280px master
 * means the stored file's name matches what it actually is. The result depends only
 * on the preset set and the source, never on which presets happen to be pending.
 */
export const redundantPresets = (
  presets: Record<string, ResolvedPreset>,
  source: { height: number; width: number },
): Map<string, 'duplicate-size' | 'source-smaller'> => {
  const redundant = new Map<string, 'duplicate-size' | 'source-smaller'>()
  const keptPerFamily = new Map<string, { cap: number; name: string }>()

  for (const [name, preset] of Object.entries(presets)) {
    const { aspectRatio, maxHeight, maxWidth } = preset.encoding
    if (maxWidth === undefined && maxHeight === undefined) {
      continue
    }

    const ratio = aspectRatio ? parseAspectRatio(aspectRatio) : null
    const available =
      ratio === null
        ? source
        : {
            height: Math.min(source.height, source.width / ratio),
            width: Math.min(source.width, source.height * ratio),
          }

    const fillsWidth = maxWidth === undefined || maxWidth >= available.width
    const fillsHeight = maxHeight === undefined || maxHeight >= available.height
    if (!fillsWidth || !fillsHeight) {
      continue // a real downscale
    }

    // Compared as widths so height- and width-capped rungs can be ranked together.
    const cap =
      maxWidth ??
      (maxHeight as number) * (available.height ? available.width / available.height : 1)
    const family = aspectRatio ?? 'source'
    const kept = keptPerFamily.get(family)
    if (!kept) {
      keptPerFamily.set(family, { name, cap })
    } else if (cap < kept.cap) {
      redundant.set(kept.name, 'source-smaller')
      keptPerFamily.set(family, { name, cap })
    } else {
      redundant.set(name, 'source-smaller')
    }
  }

  // Two presets can also converge below full size — a collection-wide `maxWidth`
  // intersecting the ladder squashes every rung above it onto the same frame. Keep
  // the tightest-capped of each identical output size, for the same reason as above:
  // the stored file's name should describe what it actually is.
  const keptPerSize = new Map<string, { cap: number; name: string }>()
  for (const [name, preset] of Object.entries(presets)) {
    const { aspectRatio, maxHeight, maxWidth } = preset.encoding
    if (redundant.has(name) || (maxWidth === undefined && maxHeight === undefined)) {
      continue
    }
    const out = outputDimensions(preset, source)
    const key = `${aspectRatio ?? 'source'}:${Math.round(out.width)}x${Math.round(out.height)}`
    const cap = maxWidth ?? (maxHeight as number)
    const kept = keptPerSize.get(key)
    if (!kept) {
      keptPerSize.set(key, { name, cap })
      // `<=` rather than `<`: once a collection-wide cap has squashed several rungs
      // their caps are equal, and the later one is the smaller-named rung — which is
      // the one whose name describes the frame that actually gets stored.
    } else if (cap <= kept.cap) {
      redundant.set(kept.name, 'duplicate-size')
      keptPerSize.set(key, { name, cap })
    } else {
      redundant.set(name, 'duplicate-size')
    }
  }

  return redundant
}

/**
 * Merges one collection's overrides over the plugin-level config before resolution.
 * Shallow per option, except `encoding`, which merges key-by-key so a collection
 * can adjust `crf` without redeclaring the codec. `presets` replaces wholesale — a
 * collection with its own renditions owns the full set.
 */
export const mergeCollectionOverrides = (
  pluginConfig: VideoOptimizerConfig,
  overrides: true | VideoOptimizerCollectionOverrides,
): VideoOptimizerConfig => {
  if (overrides === true) {
    return pluginConfig
  }
  return {
    ...pluginConfig,
    ...overrides,
    encoding: { ...pluginConfig.encoding, ...overrides.encoding },
  }
}

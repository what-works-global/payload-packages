import type {
  ResolvedPreset,
  ResolvedVideoWebmConfig,
  VideoPreset,
  VideoWebmCollectionOverrides,
  VideoWebmPluginConfig,
  WebmEncodingOptions,
} from '../types.js'

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

export const DEFAULT_TASK_SLUG = 'video-webm-convert'

export const DEFAULT_QUEUE = 'video-webm'

/**
 * Payload's own default is no retries, and cron only picks up jobs that are still
 * runnable — an unretried first failure would be terminal.
 */
export const DEFAULT_RETRIES = 3

/**
 * The single default rendition: one WebM using the collection's encoding unchanged.
 * The `webm` key is special-cased in filenames (`clip.webm`, no suffix).
 */
export const DEFAULT_PRESETS: Record<string, VideoPreset> = { webm: {} }

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Safe-by-default cap on simultaneous ffmpeg processes. VP9 encoding saturates
 * several cores per encode, so unlimited concurrency can starve a small deployment;
 * `maxConcurrentEncodes: null` opts back into unlimited.
 */
export const DEFAULT_MAX_CONCURRENT_ENCODES = 2

/**
 * Google's published VP9 VOD constant-quality recommendations, by frame height.
 * Heights outside the table fall back to the plugin's CRF default.
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

/** 16:9 height for a ladder width, used only to pick that rung's CRF from the table. */
const ladderCrfForWidth = (width: number): number =>
  LADDER_CRF[Math.round(width / (16 / 9) / 2) * 2] ?? 33

/**
 * Width-based ladder: one preset per width, capped so nothing is ever upscaled, with
 * each rung's CRF taken from the resolution table via its 16:9 height. Widths suit
 * layout work better than heights — a slot is measured by how wide it is.
 *
 * ```ts
 * presets: {
 *   ...widthPresets(),                                                   // 2560w … 426w
 *   ...widthPresets([1080, 720], { aspectRatio: '9:16', prefix: 'portrait' }),
 * }
 * ```
 *
 * With `aspectRatio` the rungs are cropped to that shape first (positioned by the
 * document's focal point), which is the one case worth a separate encode: `cover` on
 * a landscape master in a 9:16 slot downloads roughly 3× the pixels it shows.
 */
export const widthPresets = (
  widths: number[] = DEFAULT_WIDTH_LADDER,
  options: { aspectRatio?: string; prefix?: string } = {},
): Record<string, VideoPreset> =>
  Object.fromEntries(
    widths.map((width) => {
      const name = options.prefix ? `${options.prefix}-${width}w` : `${width}w`
      return [
        name,
        {
          encoding: {
            ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
            crf: ladderCrfForWidth(width),
            maxWidth: width,
          },
          label: options.prefix ? `${options.prefix} ${width}px` : `${width}px`,
        } satisfies VideoPreset,
      ]
    }),
  )

/**
 * Constant-quality target for {@link sourcePreset}. VP9 is visually transparent for
 * most material somewhere around CRF 15–24; 18 sits at the high-quality end of that
 * band without the size explosion of true lossless.
 */
const SOURCE_CRF = 18

/**
 * A single faithful rendition: the source at its own resolution, with nothing else
 * touched. Any `maxWidth`/`maxHeight` inherited from the collection's `encoding` is
 * cleared — a preset that means "the source, as WebM" must never quietly resize.
 *
 * It keeps the `webm` key, so the file is plain `clip.webm` with no suffix:
 *
 * ```ts
 * presets: { ...resolutionPresets([360, 720]), ...sourcePreset() }
 * ```
 *
 * Note that mp4 → WebM is always a re-encode: WebM carries only VP8/VP9/AV1 video
 * and Opus/Vorbis audio, so an H.264 stream cannot simply be remuxed into it.
 * "Unchanged" here means nothing is resized, cropped or dropped and the quality
 * target is high enough to be indistinguishable in normal viewing — not
 * bit-identical. For genuinely lossless VP9, pass
 * `sourcePreset({ extraArgs: ['-lossless', '1'] })` and expect a file several times
 * larger than the source, which `skipIfLarger` will then usually discard.
 */
export const sourcePreset = (encoding: WebmEncodingOptions = {}): Record<string, VideoPreset> => ({
  webm: {
    encoding: { crf: SOURCE_CRF, maxHeight: undefined, maxWidth: undefined, ...encoding },
    label: 'Original quality',
  },
})

const fail = (message: string): never => {
  throw new Error(`[payload-video-webm] ${message}`)
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
 * Applies defaults and validates one encoding block — the ranges ffmpeg would
 * otherwise reject with an opaque encoder error mid-job. `context` names the
 * offending option in errors (`encoding` or `presets.<name>.encoding`).
 */
const resolveEncoding = (
  encoding: WebmEncodingOptions,
  context: string,
): ResolvedVideoWebmConfig['encoding'] => {
  const codec = encoding.codec ?? 'vp9'
  const crf = encoding.crf ?? 32
  const speed = encoding.speed ?? 2

  // TS narrows codec to the union, but a typo'd value from untyped config would
  // otherwise silently select VP8 in buildFfmpegArgs.
  if (codec !== 'vp8' && codec !== 'vp9') {
    fail(`${context}.codec must be 'vp8' or 'vp9', got ${JSON.stringify(codec)}`)
  }
  assertIntegerInRange(crf, 0, 63, `${context}.crf`)
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
export const resolveConfig = (pluginConfig: VideoWebmPluginConfig): ResolvedVideoWebmConfig => {
  const timeoutMs = pluginConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxInputFileSize = pluginConfig.maxInputFileSize ?? null
  const retries = pluginConfig.retries ?? DEFAULT_RETRIES
  // undefined → the safe default; an explicit null opts into unlimited.
  const maxConcurrentEncodes =
    pluginConfig.maxConcurrentEncodes === undefined
      ? DEFAULT_MAX_CONCURRENT_ENCODES
      : pluginConfig.maxConcurrentEncodes

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`timeoutMs must be a positive number of milliseconds, got ${timeoutMs}`)
  }
  if (maxInputFileSize !== null) {
    assertPositiveInteger(maxInputFileSize, 'maxInputFileSize')
  }
  if (maxConcurrentEncodes !== null) {
    assertPositiveInteger(maxConcurrentEncodes, 'maxConcurrentEncodes')
  }
  if (!Number.isInteger(retries) || retries < 0) {
    fail(`retries must be a non-negative integer, got ${retries}`)
  }

  const baseEncoding = pluginConfig.encoding ?? {}
  const presetEntries = Object.entries(pluginConfig.presets ?? DEFAULT_PRESETS)
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
        { ...baseEncoding, ...preset.encoding },
        `presets.${name}.encoding`,
      ),
      label: preset.label ?? name,
    }
  }

  return {
    encoding: resolveEncoding(baseEncoding, 'encoding'),
    fetchSource: pluginConfig.fetchSource ?? null,
    ffmpegPath: pluginConfig.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg',
    inputMimeTypes: pluginConfig.inputMimeTypes ?? DEFAULT_INPUT_MIME_TYPES,
    maxConcurrentEncodes,
    maxInputFileSize,
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
): Set<string> => {
  const redundant = new Set<string>()
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
      redundant.add(kept.name)
      keptPerFamily.set(family, { name, cap })
    } else {
      redundant.add(name)
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
  pluginConfig: VideoWebmPluginConfig,
  overrides: true | VideoWebmCollectionOverrides,
): VideoWebmPluginConfig => {
  if (overrides === true) {
    return pluginConfig
  }
  return {
    ...pluginConfig,
    ...overrides,
    encoding: { ...pluginConfig.encoding, ...overrides.encoding },
  }
}

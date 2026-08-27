import type {
  ResolvedPreset,
  ResolvedVideoWebmConfig,
  VideoPreset,
  VideoWebmCollectionOverrides,
  VideoWebmPluginConfig,
  WebmEncodingOptions,
} from '../types.js'

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

  return {
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
    timeoutMs,
  }
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

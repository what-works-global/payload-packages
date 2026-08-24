import type {
  ResolvedVideoWebmConfig,
  VideoWebmCollectionOverrides,
  VideoWebmPluginConfig,
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

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Safe-by-default cap on simultaneous ffmpeg processes. VP9 encoding saturates
 * several cores per encode, so unlimited concurrency can starve a small deployment;
 * `maxConcurrentEncodes: null` opts back into unlimited.
 */
export const DEFAULT_MAX_CONCURRENT_ENCODES = 2

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
 * Applies defaults and validates the numeric ranges ffmpeg would otherwise reject
 * with an opaque encoder error mid-upload. Throws at plugin init, not upload time.
 */
export const resolveConfig = (pluginConfig: VideoWebmPluginConfig): ResolvedVideoWebmConfig => {
  const encoding = pluginConfig.encoding ?? {}
  const codec = encoding.codec ?? 'vp9'
  const crf = encoding.crf ?? 32
  const speed = encoding.speed ?? 2
  const timeoutMs = pluginConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxInputFileSize = pluginConfig.maxInputFileSize ?? null
  // undefined → the safe default; an explicit null opts into unlimited.
  const maxConcurrentEncodes =
    pluginConfig.maxConcurrentEncodes === undefined
      ? DEFAULT_MAX_CONCURRENT_ENCODES
      : pluginConfig.maxConcurrentEncodes

  // TS narrows codec to the union, but a typo'd value from untyped config would
  // otherwise silently select VP8 in buildFfmpegArgs.
  if (codec !== 'vp8' && codec !== 'vp9') {
    fail(`encoding.codec must be 'vp8' or 'vp9', got ${JSON.stringify(codec)}`)
  }
  assertIntegerInRange(crf, 0, 63, 'encoding.crf')
  // VP9's `good` deadline caps -cpu-used at 5; VP8 accepts up to 16.
  assertIntegerInRange(speed, 0, codec === 'vp9' ? 5 : 16, 'encoding.speed')
  if (encoding.maxWidth !== undefined) {
    assertPositiveInteger(encoding.maxWidth, 'encoding.maxWidth')
  }
  if (encoding.maxHeight !== undefined) {
    assertPositiveInteger(encoding.maxHeight, 'encoding.maxHeight')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`timeoutMs must be a positive number of milliseconds, got ${timeoutMs}`)
  }
  if (maxInputFileSize !== null) {
    assertPositiveInteger(maxInputFileSize, 'maxInputFileSize')
  }
  if (maxConcurrentEncodes !== null) {
    assertPositiveInteger(maxConcurrentEncodes, 'maxConcurrentEncodes')
  }

  return {
    encoding: {
      audioBitrate: encoding.audioBitrate ?? '128k',
      codec,
      crf,
      extraArgs: encoding.extraArgs ?? [],
      maxHeight: encoding.maxHeight,
      maxWidth: encoding.maxWidth,
      pixelFormat: encoding.pixelFormat === undefined ? 'yuv420p' : encoding.pixelFormat,
      speed,
      videoBitrate: encoding.videoBitrate ?? (codec === 'vp9' ? '0' : '1M'),
    },
    ffmpegPath: pluginConfig.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg',
    inputMimeTypes: pluginConfig.inputMimeTypes ?? DEFAULT_INPUT_MIME_TYPES,
    keepOriginal: pluginConfig.keepOriginal === true,
    maxConcurrentEncodes,
    maxInputFileSize,
    metadataFields: pluginConfig.metadataFields !== false,
    onConversionComplete: pluginConfig.onConversionComplete ?? null,
    onError: pluginConfig.onError ?? 'throw',
    shouldConvert: pluginConfig.shouldConvert ?? null,
    skipIfLarger: pluginConfig.skipIfLarger !== false,
    timeoutMs,
  }
}

/**
 * Merges one collection's overrides over the plugin-level config before resolution.
 * Shallow per option, except `encoding`, which merges key-by-key so a collection
 * can adjust `crf` without redeclaring the codec.
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

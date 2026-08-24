import type { PayloadRequest } from 'payload'

export type VideoCodec = 'vp8' | 'vp9'

export interface WebmEncodingOptions {
  /** Opus audio bitrate passed to `-b:a`. Defaults to `'128k'`. */
  audioBitrate?: string
  /** WebM video codec — `'vp9'` (libvpx-vp9, default) or `'vp8'` (libvpx). */
  codec?: VideoCodec
  /**
   * Constant-quality factor passed to `-crf`, an integer from 0–63 (lower = better
   * quality, larger file). Defaults to `32` — visually solid for web delivery with VP9.
   */
  crf?: number
  /**
   * Extra ffmpeg output arguments, appended after the generated output options and
   * just before the pinned `-f webm`. Intended for advanced ffmpeg customization,
   * e.g. `['-an']` to strip audio or `['-ac', '2']` to downmix surround for Opus.
   * For repeatable single-value options ffmpeg usually honours the last occurrence,
   * so these tend to win over the generated ones — but ffmpeg option semantics vary,
   * and invalid or conflicting arguments will fail the conversion.
   */
  extraArgs?: string[]
  /** Cap the output height in pixels (positive integer); smaller inputs are never upscaled. */
  maxHeight?: number
  /** Cap the output width in pixels (positive integer); smaller inputs are never upscaled. */
  maxWidth?: number
  /**
   * Output pixel format passed to `-pix_fmt`. Defaults to `'yuv420p'` for maximum
   * player compatibility (10-bit/4:2:2 sources are downsampled). Pass `null` to
   * keep the source pixel format.
   */
  pixelFormat?: null | string
  /**
   * libvpx encoder speed passed to `-cpu-used` (0 = slowest/best). VP9 accepts 0–5
   * with the `good` deadline; VP8 accepts 0–16. Defaults to `2` — a sane
   * quality/latency balance for upload-time encoding.
   */
  speed?: number
  /**
   * Bitrate passed to `-b:v`. Defaults to `'0'` for VP9 (pure constant-quality CRF
   * mode) and `'1M'` for VP8, where `-b:v` acts as the CRF mode's bitrate ceiling
   * and `0` would disable rate control entirely.
   */
  videoBitrate?: string
}

export interface ShouldConvertArgs {
  /** Slug of the upload collection receiving the file. */
  collection: string
  /** The incoming upload, before any conversion. */
  file: UploadedFile
  req: PayloadRequest
}

/**
 * Outcome of one conversion decision, passed to `onConversionComplete`. Emitted for
 * every upload that is a conversion candidate (video mime types, including WebM
 * bypasses) — never for unrelated uploads like images.
 */
export interface ConversionOutcome {
  /** Slug of the collection the file was uploaded to. */
  collection: string
  converted: boolean
  /** Filename after conversion; `null` when the conversion was skipped. */
  convertedFilename: null | string
  /** WebM size in bytes; `null` when the conversion was skipped. */
  convertedFilesize: null | number
  /** Wall-clock ffmpeg time in ms; `null` when no encode ran. */
  encodeDurationMs: null | number
  originalFilename: string
  originalFilesize: number
  originalMimeType: string
  skippedReason: null | SkipReason
}

/**
 * Per-collection settings for the `collections` object form. Everything from the
 * plugin config except the plugin-scoped keys: targeting (`collections`, `enabled`)
 * and the process-wide `ffmpegPath` / `maxConcurrentEncodes`.
 */
export type VideoWebmCollectionOverrides = Omit<
  VideoWebmPluginConfig,
  'collections' | 'enabled' | 'ffmpegPath' | 'maxConcurrentEncodes'
>

export interface VideoWebmPluginConfig {
  /**
   * Upload collections to convert. Defaults to every upload-enabled collection.
   * Either an array of slugs, or an object keyed by slug where `true` uses the
   * plugin-level settings and an object overrides them for that collection
   * (`encoding` is merged key-by-key). Listing a slug that isn't an upload
   * collection throws at init, so typos surface immediately.
   */
  collections?: Record<string, true | VideoWebmCollectionOverrides> | string[]
  /** Set `false` to leave the config completely untouched. Defaults to `true`. */
  enabled?: boolean
  /** WebM encoding parameters. */
  encoding?: WebmEncodingOptions
  /**
   * Path to the ffmpeg binary. Defaults to `process.env.FFMPEG_PATH` or `'ffmpeg'`
   * from `PATH`. Point it at `ffmpeg-static`'s export if you'd rather ship a binary
   * with your app than manage a system install.
   */
  ffmpegPath?: string
  /**
   * Mime types eligible for conversion, matched against the client-declared
   * `req.file.mimetype` (no content sniffing). Supports `'video/*'` wildcards.
   * `video/webm` uploads are always left alone, even when this list includes them.
   * Defaults to {@link DEFAULT_INPUT_MIME_TYPES} — the common non-WebM video types.
   */
  inputMimeTypes?: string[]
  /**
   * Cap on simultaneous ffmpeg processes across this plugin instance (per Node.js
   * process). Further eligible uploads wait their turn inside the request. Defaults
   * to `2` — VP9 encoding saturates several cores per encode, so the default favours
   * a responsive server over upload throughput. Pass `null` for unlimited.
   */
  maxConcurrentEncodes?: null | number
  /**
   * Skip files larger than this many bytes (they upload unconverted). Guards the
   * request against encodes that would outlive serverless/request timeouts. This is
   * a conversion guard only — it does not raise or bypass Payload's `upload.limits`
   * or any hosting-provider body-size limit. Unset by default.
   */
  maxInputFileSize?: number
  /**
   * Inject a read-only `videoWebm` sidebar group (converted flag, original
   * filename/mime/size, encode duration, skip reason) into target collections.
   * Defaults to `true`.
   */
  metadataFields?: boolean
  /**
   * Called after every conversion decision on a candidate video upload — converted,
   * or skipped as `output-larger`, `input-too-large`, `already-webm`, `filtered`
   * (vetoed by `shouldConvert`), or `ffmpeg-failed` (with `onError: 'skip'`). Not
   * called for non-video uploads (`mimetype` outside `inputMimeTypes`) or when a
   * failed conversion is about to reject the upload (`onError: 'throw'`). Errors
   * thrown here are logged as warnings and never fail the upload.
   */
  onConversionComplete?: (outcome: ConversionOutcome) => Promise<void> | void
  /**
   * What to do when ffmpeg fails or is missing: `'throw'` (default) rejects the
   * upload with the ffmpeg error; `'skip'` logs a warning and stores the original
   * file unconverted.
   */
  onError?: 'skip' | 'throw'
  /**
   * Advanced escape hatch: veto individual conversions. Runs after the built-in
   * guards (already-WebM, `inputMimeTypes`, `maxInputFileSize`) have all passed, so
   * it only sees files that would otherwise convert. Return `false` to store the
   * original untouched — reported to `onConversionComplete` as `filtered`, but not
   * recorded in the metadata group (an intentional veto is not an anomaly).
   * Exceptions propagate and fail the upload regardless of `onError` — a broken
   * predicate is a config bug, not an encode failure.
   */
  shouldConvert?: (args: ShouldConvertArgs) => boolean | Promise<boolean>
  /**
   * When the WebM output ends up larger than the source (already-efficient sources,
   * tiny clips), keep the original instead. Defaults to `true`.
   */
  skipIfLarger?: boolean
  /**
   * Kill ffmpeg (SIGKILL) and fail the conversion after this many ms.
   * Defaults to 10 minutes.
   */
  timeoutMs?: number
}

/** {@link VideoWebmPluginConfig} with every default applied and validated. */
export interface ResolvedVideoWebmConfig {
  encoding: Pick<WebmEncodingOptions, 'maxHeight' | 'maxWidth'> &
    Required<Omit<WebmEncodingOptions, 'maxHeight' | 'maxWidth'>>
  ffmpegPath: string
  inputMimeTypes: string[]
  /** `null` = unlimited (explicit opt-out). */
  maxConcurrentEncodes: null | number
  maxInputFileSize: null | number
  metadataFields: boolean
  onConversionComplete: ((outcome: ConversionOutcome) => Promise<void> | void) | null
  onError: 'skip' | 'throw'
  shouldConvert: ((args: ShouldConvertArgs) => boolean | Promise<boolean>) | null
  skipIfLarger: boolean
  timeoutMs: number
}

/** Subset of Payload's `req.file` the plugin reads — kept structural for testability. */
export interface UploadedFile {
  data: Buffer
  mimetype: string
  name: string
  size: number
  tempFilePath?: string
}

export type SkipReason =
  | 'already-webm'
  | 'ffmpeg-failed'
  | 'filtered'
  | 'input-too-large'
  | 'mime-not-matched'
  | 'output-larger'

export type ConversionDecision = { convert: false; reason: SkipReason } | { convert: true }

/**
 * Stashed on `req.context` by the beforeOperation hook so the beforeChange hook can
 * stamp the metadata fields after Payload has processed the (possibly swapped) file.
 */
export interface ConversionRecord {
  converted: boolean
  encodeDurationMs: null | number
  originalFilename: null | string
  originalFilesize: null | number
  originalMimeType: null | string
  skippedReason: null | SkipReason
}

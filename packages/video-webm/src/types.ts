import type { JsonObject, Payload, PayloadRequest } from 'payload'

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
   * with the `good` deadline; VP8 accepts 0–16. Defaults to `2` — encoding runs in a
   * background job, so latency matters less than in-request conversion would.
   */
  speed?: number
  /**
   * Bitrate passed to `-b:v`. Defaults to `'0'` for VP9 (pure constant-quality CRF
   * mode) and `'1M'` for VP8, where `-b:v` acts as the CRF mode's bitrate ceiling
   * and `0` would disable rate control entirely.
   */
  videoBitrate?: string
}

/**
 * One named output rendition. Preset `encoding` merges key-by-key over the
 * collection's `encoding`, so codec/audio settings are declared once and presets
 * only say what differs (usually dimensions and quality).
 */
export interface VideoPreset {
  /** Encoding overrides for this rendition. */
  encoding?: WebmEncodingOptions
  /** Human-readable name, e.g. `'720p HD'`. Defaults to the preset key. */
  label?: string
}

/** Serialisable description of one queued conversion, handed to `dispatch`. */
export interface DispatchJob {
  /** Slug of the upload collection the source document lives in. */
  collection: string
  /** ID of the source document awaiting a WebM sidecar. */
  docId: number | string
  /** ID of the durable Payload Jobs row — run it with `payload.jobs.runByID({ id })`. */
  jobId: number | string
  /** Filename of the source at queue time (the job no-ops if it changed since). */
  sourceFilename: string
}

/**
 * How the host backgrounds a queued conversion. The plugin can't know what platform
 * it runs on, so the host decides:
 *
 * ```ts
 * dispatch: (_job, { run }) => after(run)          // Next.js on Vercel
 * dispatch: (_job, { run }) => waitUntil(run())    // Cloudflare Workers
 * dispatch: (_job, { run }) => void run()          // long-running Node server
 * dispatch: (job) => qstash.publishJSON({ body: job }) // external queue — ignores `run`
 * ```
 *
 * `job` is serialisable for hosts with real queue infrastructure; `run` executes the
 * queued job in-process. Return nothing for fire-and-forget; return a promise and the
 * hook awaits it. When unset, the plugin runs the job inline (the upload waits) and
 * warns at boot — slow beats a floating promise on platforms that freeze after the
 * response.
 */
export type Dispatch = (
  job: DispatchJob,
  ctx: { req: PayloadRequest; run: () => Promise<void> },
) => Promise<void> | void

export interface ShouldConvertArgs {
  /** Slug of the upload collection receiving the file. */
  collection: string
  /** The incoming upload, before any conversion. */
  file: UploadedFile
  req: PayloadRequest
}

export interface FetchSourceArgs {
  /** Slug of the collection the document lives in. */
  collection: string
  /** The source upload document (depth 0). */
  doc: JsonObject
  payload: Payload
}

/**
 * Outcome of one conversion decision, passed to `onConversionComplete`. Emitted for
 * every video candidate — queued conversions when their job finishes (converted,
 * output-larger, or failed) and early skips at upload time (already-webm, filtered,
 * input-too-large). Never emitted for non-video uploads.
 */
export interface ConversionOutcome {
  /** Slug of the collection the file was uploaded to. */
  collection: string
  converted: boolean
  /** Filename of the WebM sidecar; `null` when the conversion was skipped or failed. */
  convertedFilename: null | string
  /** WebM size in bytes; `null` when the conversion was skipped or failed. */
  convertedFilesize: null | number
  /** Wall-clock ffmpeg time in ms; `null` when no encode ran. */
  encodeDurationMs: null | number
  /** Error message when the job failed; `null` otherwise. */
  error: null | string
  originalFilename: string
  originalFilesize: number
  originalMimeType: string
  /** Which rendition this outcome is about; `null` for upload-time decisions. */
  preset: null | string
  skippedReason: null | SkipReason
}

/**
 * Per-collection settings for the `collections` object form. Everything from the
 * plugin config except the plugin-scoped keys: targeting (`collections`, `enabled`),
 * the process-wide `ffmpegPath` / `maxConcurrentEncodes`, and the job plumbing
 * (`dispatch`, `queue`, `retries`, `taskSlug`), which is one pipeline per plugin.
 */
export type VideoWebmCollectionOverrides = Omit<
  VideoWebmPluginConfig,
  | 'collections'
  | 'dispatch'
  | 'enabled'
  | 'ffmpegPath'
  | 'maxConcurrentEncodes'
  | 'queue'
  | 'retries'
  | 'taskSlug'
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
  /**
   * How to background queued conversions — see {@link Dispatch}. When unset, the
   * job runs inline before the upload response returns (safe everywhere, but the
   * upload waits for the encode) and the plugin warns at boot.
   */
  dispatch?: Dispatch
  /** Set `false` to leave the Payload config completely untouched. Defaults to `true`. */
  enabled?: boolean
  /** WebM encoding parameters. */
  encoding?: WebmEncodingOptions
  /**
   * Reads the source video's bytes inside the job. Defaults to reading the
   * collection's `staticDir` for local storage, else fetching `doc.url` resolved
   * against `serverURL` — override for access-controlled storage the default
   * cannot reach.
   */
  fetchSource?: (args: FetchSourceArgs) => Promise<Buffer>
  /**
   * Path to the ffmpeg binary. Defaults to `process.env.FFMPEG_PATH` or `'ffmpeg'`
   * from `PATH`. Point it at `ffmpeg-static`'s export if you'd rather ship a binary
   * with your app than manage a system install. ffmpeg is only needed by the
   * process that runs the jobs — a separate `payload jobs:run` container can carry
   * it instead of the web app.
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
   * process). Defaults to `2` — VP9 encoding saturates several cores per encode, so
   * the default favours a responsive server over encode throughput. Pass `null`
   * for unlimited.
   */
  maxConcurrentEncodes?: null | number
  /**
   * Skip files larger than this many bytes (they stay unconverted, with the skip
   * recorded). This is a conversion guard only — it does not raise or bypass
   * Payload's `upload.limits` or any hosting-provider body-size limit. Unset by
   * default.
   */
  maxInputFileSize?: number
  /**
   * Inject a read-only `videoWebm` sidebar group (status, original filename/mime/
   * size, encode duration, skip reason, last error) into target collections.
   * Defaults to `true`.
   */
  metadataFields?: boolean
  /**
   * Called after every conversion decision on a candidate video upload — once per
   * preset when the job converts, skips (`output-larger`) or fails, and once for
   * upload-time skips (`preset: null`). Not called for non-video uploads. Runs in
   * whichever process executed the decision. Errors thrown here are logged as
   * warnings and never fail the upload or the job.
   */
  onConversionComplete?: (outcome: ConversionOutcome) => Promise<void> | void
  /**
   * The renditions to generate — one hidden sidecar document per preset, linked
   * from the source via `webmVersions` rows (`{ preset, video }`). Declaration
   * order is preference order (first = best, served first by the frontend
   * helpers). Keys become filename suffixes (`clip-720p.webm`), so stick to
   * letters, digits and dashes. Defaults to a single `webm` preset using the
   * collection's `encoding` unchanged. See `resolutionPresets()` for a ready-made
   * quality ladder.
   */
  presets?: Record<string, VideoPreset>
  /** Payload Jobs queue name conversions are queued to. Defaults to `'video-webm'`. */
  queue?: string
  /**
   * Retry attempts for a failed conversion job. Defaults to `3` — Payload's own
   * default is none, and cron only picks up jobs that are still runnable, so an
   * unretried first failure would be terminal.
   */
  retries?: number
  /**
   * Advanced escape hatch: veto individual conversions at upload time. Runs after
   * the built-in guards (already-WebM, `inputMimeTypes`, `maxInputFileSize`) have
   * all passed, so it only sees files that would otherwise queue. Return `false`
   * to keep the original untouched — reported to `onConversionComplete` as
   * `filtered`, but not recorded in the metadata group. Exceptions propagate and
   * fail the upload — a broken predicate is a config bug.
   */
  shouldConvert?: (args: ShouldConvertArgs) => boolean | Promise<boolean>
  /**
   * When the WebM output ends up larger than the source (already-efficient sources,
   * tiny clips), skip storing it. Defaults to `true`.
   */
  skipIfLarger?: boolean
  /**
   * Slug the conversion task is registered under in `config.jobs.tasks`. Defaults
   * to `'video-webm-convert'`; only needs changing when running two plugin
   * instances side by side.
   */
  taskSlug?: string
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
  fetchSource: ((args: FetchSourceArgs) => Promise<Buffer>) | null
  ffmpegPath: string
  inputMimeTypes: string[]
  /** `null` = unlimited (explicit opt-out). */
  maxConcurrentEncodes: null | number
  maxInputFileSize: null | number
  metadataFields: boolean
  onConversionComplete: ((outcome: ConversionOutcome) => Promise<void> | void) | null
  /** Preset name → fully resolved encoding, in declaration (= preference) order. */
  presets: Record<string, ResolvedPreset>
  shouldConvert: ((args: ShouldConvertArgs) => boolean | Promise<boolean>) | null
  skipIfLarger: boolean
  timeoutMs: number
}

/** {@link VideoPreset} with the collection's encoding merged in and validated. */
export interface ResolvedPreset {
  encoding: ResolvedVideoWebmConfig['encoding']
  label: string
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
  | 'filtered'
  | 'input-too-large'
  | 'mime-not-matched'
  | 'output-larger'

export type ConversionDecision = { convert: false; reason: SkipReason } | { convert: true }

/** Lifecycle of one upload's conversion, stored in the `videoWebm` metadata group. */
export type ConversionStatus = 'complete' | 'failed' | 'queued' | 'skipped'

/** Shape of the `videoWebm` metadata group on target documents. */
export interface ConversionRecord {
  encodeDurationMs: null | number
  /** Last job error (truncated); retries may later flip the status to complete. */
  error: null | string
  originalFilename: null | string
  originalFilesize: null | number
  originalMimeType: null | string
  skippedReason: null | SkipReason
  status: ConversionStatus | null
}

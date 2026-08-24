# @whatworks/payload-video-webm

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-video-webm" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Payload plugin that converts video uploads (mp4, mov, mkv, …) to **WebM (VP9 + Opus)** during the upload request itself, so your frontend serves often substantially smaller files. Two modes:

- **Replace (default)**: one eligible video comes in → one WebM replaces it before Payload's storage processing. **The original file is not retained.**
- **`keepOriginal: true`**: the original stays the document's stored file (in S3 or wherever the collection's storage points), and the WebM is stored alongside it as a hidden sidecar document linked via `webmVersion` — the frontend renders the WebM, the source stays safe.

- **Storage-adapter agnostic** — the conversion swaps `req.file` before Payload processes the upload, so filename, `mimeType` and `filesize` are all derived from the converted file and stored through whatever storage the collection uses (local disk, `@payloadcms/storage-s3`, Vercel Blob, …).
- **Zero runtime dependencies** — spawns the `ffmpeg` binary directly via argument arrays (never through a shell). No fluent-ffmpeg, no Redis, no worker process.
- **Guardrails built in** — keeps the original when the WebM would be _larger_ (`skipIfLarger`), can skip files above a size cap (`maxInputFileSize`), caps parallel encodes (`maxConcurrentEncodes`), kills runaway encodes (`timeoutMs`), and always cleans up its temp files.
- **Honest metadata and observability** — a read-only `videoWebm` sidebar group records what happened to each upload, and an `onConversionComplete` callback feeds your own metrics.
- **Fails loud or degrades gracefully** — `onError: 'throw'` (default) rejects the upload with the real ffmpeg error; `onError: 'skip'` stores the original unconverted and logs a warning.

## Installation

```sh
pnpm add @whatworks/payload-video-webm
```

## Quick usage

```ts
import { videoWebmPlugin } from '@whatworks/payload-video-webm'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    // Converts video uploads in every upload collection by default.
    videoWebmPlugin(),
  ],
})
```

Upload an mp4 — it lands in storage as `clip.webm` with `mimeType: 'video/webm'`, and the doc's `filesize` is the converted size. Nothing else in your app changes; render it like any Payload upload:

```tsx
<video controls src={media.url ?? undefined} />
```

If a collection restricts `upload.mimeTypes`, the plugin appends `video/webm` for you so the converted file passes Payload's mime validation.

## Compatibility

| Requirement | Supported                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload     | `>=3.54.0 <4` (peer dependency)                                                                                                                                                                         |
| Node.js     | `>=20.9.0`                                                                                                                                                                                              |
| ffmpeg      | Any build with the `libvpx`/`libvpx-vp9` and `libopus` encoders — every standard distribution build (apt, brew, static builds, [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)) has them |
| OS          | Linux and macOS (anywhere `ffmpeg` can be spawned); Windows should work but is untested                                                                                                                 |

The plugin looks for `ffmpeg` on `PATH`, or wherever `FFMPEG_PATH` / the `ffmpegPath` option points (e.g. `ffmpegPath: require('ffmpeg-static')`). At boot it verifies the binary is executable **and** that the required encoders are compiled in, logging a warning otherwise — a broken install surfaces at init, not on the first editor upload.

## Deployment and serverless warning

Conversion happens **inside the upload HTTP request, on the Payload server**. Before deploying, make sure your platform fits:

- **The upload must reach `req.file`.** Client-side uploads that go straight to storage (`upload.clientUploads`, presigned-URL flows) bypass the Payload server entirely and are **never converted**.
- **Request execution time**: the request waits for the encode. Serverless platforms with short function timeouts (e.g. default Vercel/Lambda limits) will kill long encodes mid-request. Use `maxInputFileSize` to keep big files out of the encoder, raise `encoding.speed`, or run Payload on a long-lived server for video-heavy workloads.
- **Request body size**: `maxInputFileSize` only decides whether the plugin _converts_ a file — it does **not** raise or bypass Payload's `upload.limits` or your hosting provider's body-size limit. A file too large for your platform never reaches the plugin at all.
- **CPU**: VP9 encoding is CPU-intensive, and every simultaneous eligible upload spawns another ffmpeg process. See [Performance and concurrency](#performance-and-concurrency).

## Options

```ts
videoWebmPlugin({
  // Upload collections to convert. Defaults to every upload collection.
  // Array form — these collections, plugin-level settings:
  //   collections: ['media'],
  // …or object form — `true` inherits, an object overrides per collection
  // (everything below except ffmpegPath/maxConcurrentEncodes; `encoding`
  // merges key-by-key). Unknown or non-upload slugs throw at init.
  collections: {
    media: true,
    videos: { encoding: { crf: 30, maxWidth: 1920 } },
  },

  // Kill switch: `false` leaves the Payload config completely untouched.
  enabled: true,

  // Keep the uploaded original as the document's file and store the WebM as a
  // hidden sidecar document in the same collection (same storage adapter),
  // linked via the `webmVersion` relationship. Default false: the WebM replaces
  // the upload and the original is not retained. See "Keeping the original".
  keepOriginal: false,

  // Mime types eligible for conversion, matched against the client-declared
  // req.file.mimetype ('video/*' wildcards supported). `video/webm` uploads are
  // always left alone, even if listed here. Defaults (exact list):
  // video/3gpp, video/mp4, video/mpeg, video/ogg, video/quicktime, video/x-flv,
  // video/x-m4v, video/x-matroska, video/x-ms-wmv, video/x-msvideo
  inputMimeTypes: ['video/mp4', 'video/quicktime'],

  // ffmpeg binary. Defaults to FFMPEG_PATH or 'ffmpeg' from PATH.
  ffmpegPath: '/usr/bin/ffmpeg',

  encoding: {
    codec: 'vp9', // 'vp9' (default) or 'vp8'
    crf: 32, // constant quality 0–63, lower = better/larger (default 32)
    speed: 2, // -cpu-used: 0 slowest/best … 5 (VP9) / 16 (VP8) fastest (default 2)
    audioBitrate: '128k', // Opus bitrate (default '128k')
    maxWidth: 1920, // cap dimensions — smaller sources are never upscaled
    maxHeight: 1080,
    pixelFormat: 'yuv420p', // default; pass null to keep the source format
    videoBitrate: '0', // default '0' for VP9 (pure CRF), '1M' ceiling for VP8
    // Advanced: appended after the generated output options, before the pinned
    // `-f webm`. ffmpeg usually honours the last occurrence of a repeated option,
    // so these tend to win — but semantics vary per option, and invalid or
    // conflicting arguments will fail the conversion.
    extraArgs: ['-an'],
  },

  // Keep the original when the WebM output would be larger. Default true.
  skipIfLarger: true,

  // Skip files above this many bytes — they upload unconverted, with a warning.
  maxInputFileSize: 200 * 1024 * 1024,

  // Cap simultaneous ffmpeg processes for this plugin instance (per Node.js
  // process); further uploads wait inside their request. Defaults to 2 — a
  // safe-by-default cap, since each VP9 encode saturates several cores.
  // Pass null for unlimited.
  maxConcurrentEncodes: 2,

  // Kill ffmpeg (SIGKILL) and fail the conversion after this long. Default 10 min.
  timeoutMs: 10 * 60 * 1000,

  // 'throw' (default) rejects the upload with the underlying ffmpeg error;
  // 'skip' logs a warning and stores the original file unconverted.
  onError: 'skip',

  // Injects the read-only `videoWebm` sidebar group. Default true.
  metadataFields: true,

  // Advanced veto, called only for files that already passed every guard above
  // (already-WebM, inputMimeTypes, maxInputFileSize). Return false to store the
  // original untouched — reported to onConversionComplete as 'filtered', but not
  // recorded in the metadata group. Exceptions propagate and fail the upload.
  shouldConvert: ({ collection, file, req }) => !file.name.includes('raw'),

  // Called after every conversion decision on a candidate video upload:
  // converted, or skipped as 'output-larger', 'input-too-large', 'already-webm',
  // 'filtered' (shouldConvert veto), or 'ffmpeg-failed' (with onError: 'skip').
  // Not called for non-video uploads, or when a failure is about to reject the
  // upload (onError: 'throw'). Callback errors are logged and never fail uploads.
  onConversionComplete: (outcome) => {
    console.log(outcome.collection, outcome.originalFilename, outcome.converted)
  },
})
```

## The `videoWebm` metadata group

Every targeted collection gets a read-only sidebar group (opt out with `metadataFields: false`), hidden in the admin unless a conversion or a recorded skip happened:

| Field              | Meaning                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `converted`        | Whether this upload was converted to WebM.                                                                           |
| `originalFilename` | The filename as uploaded, e.g. `clip.mp4`.                                                                           |
| `originalMimeType` | The uploaded mime type, e.g. `video/mp4`.                                                                            |
| `originalFilesize` | Source size in bytes — compare with the doc's `filesize` for the actual savings.                                     |
| `encodeDurationMs` | Wall-clock ffmpeg time for the successful encode.                                                                    |
| `skippedReason`    | `output-larger`, `input-too-large`, `ffmpeg-failed` (with `onError: 'skip'`), or `derivative-failed` (keepOriginal). |

Savings are deliberately not stored — derive them from `originalFilesize` and Payload's own `filesize`. The group is stamped only on requests that actually carry a file, so re-saving a document never clobbers the record, while replacing the file updates (or clears) it.

## How it works

The plugin adds one `beforeOperation` hook and (for metadata) one `beforeChange` hook to each targeted collection:

1. On `create`/`update` with a file, the `beforeOperation` hook checks eligibility against the **client-declared `req.file.mimetype`** (no content sniffing), the size cap, and your `shouldConvert` predicate.
2. Eligible files are transcoded through temp files in `os.tmpdir()` (always removed, even on failure or timeout), then `req.file`'s buffer, name, mime type and size are swapped for the WebM.
3. Payload's own pipeline then runs unchanged — mime validation, filename dedup, and the storage adapter all see only the converted file, which is why everything stays consistent with zero storage coupling.

**Hook ordering is deterministic**: the plugin's hooks are appended _after_ any hooks the collection already declares. Your own `beforeOperation` hooks therefore see the original upload; every later stage (`beforeValidate`, `beforeChange`, `afterChange`, …) sees the converted WebM. Plugins registered after this one that add `beforeOperation` hooks will run after the conversion. (In `keepOriginal` mode `req.file` is never touched — conversion runs in a `beforeChange` hook instead, likewise appended after yours.)

## Keeping the original

With `keepOriginal: true` (per collection or plugin-wide), the uploaded file is stored untouched as the document's own asset, and the WebM becomes a second, hidden document **in the same collection** — which is exactly what makes it storage-agnostic: the sidecar flows through the same S3/Blob/local adapter the collection already uses. The original links to it via a read-only `webmVersion` relationship.

```ts
videoWebmPlugin({
  collections: { media: { keepOriginal: true } },
})
```

Frontend — query with `depth: 1` so the relationship populates, then prefer the WebM:

```tsx
const src = media.webmVersion?.url ?? media.url
<video controls src={src ?? undefined} />
```

Lifecycle guarantees:

- Replacing the document's file **regenerates** the sidecar and deletes the stale one; replacing a video with a non-video clears the link and removes the sidecar.
- Deleting the original deletes its sidecar.
- Sidecar documents are hidden from the admin list view (via `baseListFilter`, composed with any filter you already have) and flagged with a hidden `isWebmDerivative` checkbox — they still appear in direct API queries unless you filter on that field.
- Your other document fields are copied onto the sidecar so required fields validate; fields with `unique: true` on the collection will conflict and fail sidecar creation, so avoid `keepOriginal` on collections with unique non-upload fields.
- If encoding succeeds but storing the sidecar fails with `onError: 'skip'`, the original is kept, metadata records `derivative-failed`, and the upload succeeds.

Costs to be aware of: storage is roughly doubled per video (original + WebM), and each video upload performs one extra document create. `skipIfLarger` still applies — when the WebM would be bigger, no sidecar is created and `webmVersion` stays `null`, so the `?? media.url` fallback above always does the right thing.

## Performance and concurrency

VP9 encoding is CPU-intensive: each encode saturates several cores, and each running encode is its own ffmpeg process. By default **at most 2 encodes run at once per Node.js process** (`maxConcurrentEncodes: 2`); further eligible uploads queue in-process and wait inside their request. Levers, roughly in order:

- `maxConcurrentEncodes` — raise it on beefy servers, or pass `null` for unlimited (every simultaneous upload encodes at once; ten editors uploading means ten concurrent ffmpeg processes). The cap is per Node.js instance — horizontally scaled deployments run up to the cap on each instance.
- `encoding.speed: 4–5` encodes several times faster than the default `2` for a modest quality cost — usually the right call for upload-time conversion.
- `maxInputFileSize` keeps oversized masters out of the encoder entirely (they upload unconverted).
- `onError: 'skip'` if an upload must never fail because of conversion.

For editor-sized clips (tens of MB) on `speed: 2`, expect seconds to a couple of minutes per encode.

## Development and testing

The dev sandbox (`pnpm dev`) boots a Payload admin backed by SQLite with a `media` collection wired to the plugin — upload any mp4/mov and watch it land in `dev/media/` as `.webm`. Tests (`pnpm test`) generate video fixtures with your local ffmpeg; the encode-dependent suite skips automatically when no binary is installed, while process handling (timeouts, cleanup, failure modes) is exercised with stand-in binaries and runs everywhere.

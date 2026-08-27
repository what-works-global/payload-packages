# @whatworks/payload-video-webm

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-video-webm" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Payload plugin that optimises video uploads to **WebM (VP9 + Opus)** in the background, so your frontend serves often substantially smaller files. The source file is **always stored untouched** as the document's own asset; each configured **preset** (a single WebM by default, or a full quality ladder) lands as a hidden sidecar document linked from the source via `webmVersions`, created by a durable Payload Jobs task after the upload response has already returned.

```
upload → storage write → afterChange:
                           ├─ jobs.queue(...)       durable row
                           └─ dispatch(job, {run})  host decides how to background it
         response returns ─┘
                              → runByID → transcode per preset → sidecar docs → link on source

cron → /api/payload-jobs/run?queue=video-webm     safety net, always on
```

- **The original is never replaced or deleted** — optimised versions can always be regenerated from the stored source.
- **Named presets & quality ladders** — typed per-preset encoding options (not raw ffmpeg strings), with `resolutionPresets([360, 720, 1080])` shipping Google's recommended VP9 CRF ladder.
- **Non-blocking uploads** — the editor's upload returns as soon as the file is stored, with the conversion `queued`; renditions appear when the job finishes.
- **Storage-adapter agnostic** — the sidecar is a normal document in the same collection, so it flows through the exact storage adapter (S3, Vercel Blob, local disk) the collection already uses.
- **Durable, not fire-and-forget** — conversions are Payload Jobs rows with `retries: 3`; the immediate post-upload run is an optimisation, a cron over the queue is the guarantee.
- **Zero runtime dependencies** — spawns the `ffmpeg` binary directly via argument arrays (never through a shell). No fluent-ffmpeg, no Redis, no external workers.

## Installation

```sh
pnpm add @whatworks/payload-video-webm
```

## Quick usage

```ts
import { videoWebmPlugin } from '@whatworks/payload-video-webm'
import { after } from 'next/server'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    videoWebmPlugin({
      // How your platform backgrounds the conversion (see "Dispatch" below).
      dispatch: (_job, { run }) => after(run), // Next.js on Vercel
    }),
  ],
})
```

Upload an mp4 — it stores as-is and the response returns immediately. A moment later the job attaches the renditions. On the frontend, query with `depth: 1` and use the dependency-free helpers from the **`/frontend`** subpath:

```tsx
import { getVideoSources } from '@whatworks/payload-video-webm/frontend'
;<video controls>
  {getVideoSources(media).map((s) => (
    <source key={s.src} src={s.src} type={s.type} />
  ))}
</video>
```

`getVideoSources` lists every rendition in preference order and always appends the original file last — browsers play the first source they can, so **something always plays**: before the job finishes, for skipped/failed conversions, and for browsers without WebM support alike. For a single URL there's `getWebmUrl(media, '720p') ?? media.url`.

## Compatibility

| Requirement | Supported                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload     | `>=3.54.0 <4` (peer dependency; uses the built-in Jobs Queue)                                                                                                                                           |
| Node.js     | `>=20.9.0`                                                                                                                                                                                              |
| ffmpeg      | Any build with the `libvpx`/`libvpx-vp9` and `libopus` encoders — every standard distribution build (apt, brew, static builds, [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)) has them |
| OS          | Linux and macOS (anywhere `ffmpeg` can be spawned); Windows should work but is untested                                                                                                                 |

ffmpeg is only needed by the **process that runs the jobs**. It looks for `ffmpeg` on `PATH`, or wherever `FFMPEG_PATH` / the `ffmpegPath` option points. At boot the plugin verifies the binary is executable **and** that the required encoders are compiled in, warning otherwise.

## Dispatch — how conversions get off the request

The plugin can't know what platform it's on, so the host passes in how to defer the run:

```ts
dispatch: (_job, { run }) => after(run) // Next.js on Vercel
dispatch: (_job, { run }) => waitUntil(run()) // Cloudflare Workers
dispatch: (_job, { run }) => void run() // long-running Node server
dispatch: (job) => qstash.publishJSON({ body: job }) // external queue — run the row yourself
```

`job` is serialisable (`{ collection, docId, jobId, sourceFilename }`) for hosts with real queue infrastructure; `run` executes the queued row in-process via `payload.jobs.runByID`. **When `dispatch` is unset, the job runs inline and the upload waits for the encode** — safe everywhere, and the plugin warns at boot. Slow beats a floating promise that resumes inside someone else's request on a warm serverless instance.

### The cron safety net

The immediate run is an optimisation; the durable queue is the guarantee. Anything the immediate run misses (a killed process, a crashed encode past its retries' schedule, a `dispatch` that only enqueues externally) is still a runnable row in the `video-webm` queue. Run it on a schedule — either Payload's built-in autorun:

```ts
jobs: {
  autoRun: [{ cron: '*/5 * * * *', queue: 'video-webm' }],
}
```

or an external cron hitting `GET /api/payload-jobs/run?queue=video-webm`, or `payload jobs:run --queue video-webm` in a worker container. That last shape is also the answer to ffmpeg's ~80 MB weight on serverless: keep the web app ffmpeg-free (it only writes queue rows and serves uploads) and run the jobs in a container that carries ffmpeg, pointed at the same database.

## Presets — one rendition or a whole ladder

By default every video gets a single `webm` rendition using the collection's `encoding`. Define `presets` for more control — each preset is a named, **typed** encoding override (merged key-by-key over `encoding`), and each becomes its own sidecar document with a suffixed filename (`clip-720p.webm`):

```ts
videoWebmPlugin({
  encoding: { audioBitrate: '96k' }, // shared by all presets
  presets: {
    '720p': { label: '720p HD', encoding: { maxHeight: 720, crf: 32 } },
    '360p': { label: '360p Mobile', encoding: { maxHeight: 360, crf: 36 } },
  },
})
```

Declaration order is preference order — the first preset is what `getVideoSources` serves first. Or take the ready-made quality ladder, built on Google's published VP9 CRF-per-resolution recommendations (heights never upscale, so a 480p source's `1080p` rendition stays 480p):

```ts
import { resolutionPresets } from '@whatworks/payload-video-webm'

presets: resolutionPresets([360, 720, 1080])
// → { '360p': …crf 36, '720p': …crf 32, '1080p': …crf 31 }
```

Preset advanced needs (crop filters, stripping audio, …) go through each preset's `encoding.extraArgs` — raw ffmpeg output args with the same last-one-wins caveats as everywhere else. The job encodes presets sequentially under the concurrency limiter, is **idempotent per preset** (a retry after a partial failure resumes the missing renditions instead of duplicating finished ones), and `skipIfLarger` applies per preset — a rendition that loses to the source is simply absent, and the frontend helpers fall back.

## Options

```ts
videoWebmPlugin({
  // Upload collections to convert. Defaults to every upload collection.
  // Array form — these collections, plugin-level settings:
  //   collections: ['media'],
  // …or object form — `true` inherits, an object overrides per collection
  // (`encoding` merges key-by-key). Unknown or non-upload slugs throw at init.
  collections: {
    media: true,
    videos: { encoding: { crf: 30, maxWidth: 1920 } },
  },

  // Kill switch: `false` leaves the Payload config completely untouched.
  enabled: true,

  // Renditions to generate — see "Presets" above. Default: one `webm` preset
  // using `encoding` unchanged. Keys become filename suffixes.
  presets: resolutionPresets([360, 720, 1080]),

  // How to background conversions — see "Dispatch" above. Unset = inline + warning.
  dispatch: (_job, { run }) => after(run),

  // Jobs plumbing. Defaults shown; taskSlug only matters with two plugin instances.
  queue: 'video-webm',
  retries: 3,
  taskSlug: 'video-webm-convert',

  // How the job reads the source bytes. Default: the collection's staticDir for
  // local storage, else fetching doc.url against serverURL. Override for
  // access-controlled storage the default can't reach.
  fetchSource: async ({ doc }) => myBucket.get(String(doc.filename)),

  // Mime types eligible for conversion, matched against the client-declared
  // req.file.mimetype ('video/*' wildcards supported). `video/webm` uploads are
  // always left alone, even if listed here. Defaults (exact list):
  // video/3gpp, video/mp4, video/mpeg, video/ogg, video/quicktime, video/x-flv,
  // video/x-m4v, video/x-matroska, video/x-ms-wmv, video/x-msvideo
  inputMimeTypes: ['video/mp4', 'video/quicktime'],

  // ffmpeg binary — only the jobs-running process needs it.
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

  // Skip storing the WebM when it would be larger than the source. Default true.
  skipIfLarger: true,

  // Don't queue conversions for files above this many bytes. This is a conversion
  // guard only — it does not raise Payload's upload.limits or any host body limit.
  maxInputFileSize: 500 * 1024 * 1024,

  // Cap simultaneous ffmpeg processes per Node.js process. Defaults to 2 — each
  // VP9 encode saturates several cores. Pass null for unlimited.
  maxConcurrentEncodes: 2,

  // Kill ffmpeg (SIGKILL) and fail the job attempt after this long. Default 10 min.
  timeoutMs: 10 * 60 * 1000,

  // Injects the read-only `videoWebm` sidebar group. Default true.
  metadataFields: true,

  // Advanced veto at upload time, called only for files that already passed every
  // guard above. Return false to leave the file alone — reported to
  // onConversionComplete as 'filtered', but not recorded in the metadata group.
  shouldConvert: ({ collection, file, req }) => !file.name.includes('raw'),

  // Called after every conversion decision on a candidate video: converted,
  // output-larger, failed (from the job), or already-webm / filtered /
  // input-too-large (at upload time). Never for non-video uploads. Errors here
  // are logged and never fail anything.
  onConversionComplete: (outcome) => {
    console.log(outcome.collection, outcome.originalFilename, outcome.converted)
  },
})
```

## The `videoWebm` metadata group

Every targeted collection gets a read-only sidebar group (opt out with `metadataFields: false`), hidden in the admin until the plugin recorded something:

| Field              | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `status`           | `queued` → `complete` \| `skipped` \| `failed`. Stamped `queued` at upload time.   |
| `originalFilename` | The source filename, e.g. `clip.mp4`.                                              |
| `originalMimeType` | The source mime type, e.g. `video/mp4`.                                            |
| `originalFilesize` | Source size in bytes — compare with the sidecar's `filesize` for the savings.      |
| `encodeDurationMs` | Wall-clock ffmpeg time for the successful encode.                                  |
| `skippedReason`    | `input-too-large` (at upload time) or `output-larger` (decided by the job).        |
| `error`            | Last job error, truncated — retries may still flip the status to `complete` later. |

The group is stamped only on requests that actually carry a file, so re-saving a document never clobbers the record, while replacing the file resets it (and queues a fresh conversion).

## How it works

1. **Upload time** (`beforeChange`): the cheap guards run against the client-declared `req.file.mimetype` (no content sniffing), `maxInputFileSize`, and your `shouldConvert` predicate. Candidates are stamped `status: 'queued'`; `req.file` is never touched, so the source stores byte-for-byte as uploaded.
2. **After the write** (`afterChange`): a durable job row is queued — deliberately without `req`, so the row isn't trapped inside the request's transaction — and handed to `dispatch`. The response returns.
3. **In the job**: the handler re-reads the document (bailing quietly if it was deleted or its file replaced — the immediate run, retries, and the cron can race safely), reads the source bytes from storage once, then encodes each preset that doesn't have a rendition yet under the concurrency limiter, through temp files that are always cleaned up. Every rendition is a hidden sidecar document in the same collection, linked as a `{ preset, video }` row in `webmVersions`. Failures link whatever finished, record `status: 'failed'`, and rethrow so Payload's retries resume the missing presets.

**Lifecycle guarantees**: replacing the document's file queues a re-encode of every preset and garbage-collects the stale renditions; replacing a video with a non-video clears everything; deleting the original deletes all its renditions. Sidecars are hidden from the admin list view (via `baseListFilter`, composed with any filter you already have) and flagged with a hidden `isWebmDerivative` checkbox — they still appear in direct API queries unless you filter on that field. Other document fields are copied onto the sidecar so required fields validate; collections with `unique` non-upload fields will conflict on sidecar creation, so avoid targeting those.

**Hook ordering**: the plugin's hooks are appended after any hooks the collection already declares, and since nothing mutates `req.file`, your hooks always see the original upload. The sidecar arrives later as its own document create, which runs your collection hooks too — check `isWebmDerivative` in your hooks if you need to tell them apart.

## Performance and cost

- Storage is source + one WebM per preset — that's the point: the source is never sacrificed, and optimised versions can be regenerated at any time. A full ladder multiplies encode time and storage accordingly; start with the sizes your players actually use.
- VP9 is CPU-intensive. `maxConcurrentEncodes` (default 2, per process) stops simultaneous uploads from stampeding the encoder; for real volume, move the queue to a dedicated `payload jobs:run` container.
- `maxInputFileSize` keeps oversized masters out of the encoder entirely; `skipIfLarger` (default on) refuses to store a WebM that lost to the original.
- Client-side uploads that bypass the Payload server (`upload.clientUploads`, presigned flows) never trigger the `afterChange` hook and are not converted.

## Development and testing

The dev sandbox (`pnpm dev`) boots a Payload admin backed by SQLite with a `media` collection wired to the plugin — upload an mp4/mov, watch the response return immediately, then refresh to see `status` flip to `complete` with the `WebM version` link. Tests (`pnpm test`) generate video fixtures with your local ffmpeg; the encode-dependent suite skips automatically when no binary is installed, while jobs plumbing, process handling, and failure modes are exercised with stand-in binaries and run everywhere.

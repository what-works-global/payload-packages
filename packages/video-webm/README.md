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
- **Durable, not fire-and-forget** — conversions are Payload Jobs rows with `retries: 3`, guarded by a generation counter so a slow or duplicated run can never overwrite newer renditions.
- **Live admin control panel** — polls while the job runs (no refreshing), then shows a condensed per-preset table with sizes and savings, open-in-new-tab, and one-click regeneration against the current config.
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

Then regenerate the import map so the admin can resolve the plugin's status panel:

```sh
payload generate:importmap
```

Upload an mp4 — it stores as-is and the response returns immediately, while the sidebar panel shows **Optimising…** and updates itself when the job finishes (status, each rendition's file size and savings, links to the sidecar documents). No refresh needed. On the frontend, query with `depth: 1` and use the dependency-free helpers from the **`/frontend`** subpath:

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

`job` is serialisable (`{ collection, docId, generation, jobId, sourceFilename }`) for hosts with real queue infrastructure; `run` executes the queued row in-process via `payload.jobs.runByID`, waiting first for the upload's transaction to commit so the job can actually see the document.

**When `dispatch` is unset** the plugin falls back to running the job itself, and what that means depends on your database:

| Database                                    | Without `dispatch`                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No transactions (Mongo standalone, SQLite)  | The job runs **inline** — `payload.create()` resolves only once the encode is done.                                           |
| Transactions (Postgres, Mongo replica sets) | The job starts **detached** after the upload commits, because awaiting it inside the hook would deadlock against that commit. |

The detached case is exactly where a platform that freezes after the response can lose the run, so **configure `dispatch` (or a jobs runner) in production**; the plugin warns at boot when it isn't set. The durable row survives either way.

### The cron safety net

A durable row means an interrupted conversion isn't lost — with one important limit. Payload marks a job `processing` the moment it starts and has no lease or stall recovery, so:

- **Never-started and cleanly-failed rows** (a `dispatch` that only enqueues externally, an encode that threw, retries still pending) are picked up by cron. This is the guarantee.
- **A run killed mid-encode** (SIGKILL, a frozen serverless instance) leaves its row claimed. Cron will not re-run it, and the document stays `queued`. The fix is one click of **↺ all** in the sidebar panel — it queues a _fresh_ job, and the per-preset idempotency means only what's missing is encoded.

Run the queue on a schedule — either Payload's built-in autorun:

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

### A straight conversion of the source

`sourcePreset()` is the "just make it WebM" rendition: the source's own resolution, nothing resized or cropped, at a near-transparent quality (CRF 18). It clears any `maxWidth`/`maxHeight` inherited from the collection's `encoding` — a preset that means _the source, as WebM_ must not quietly resize — and keeps the `webm` key, so the file is plain `clip.webm` with no suffix:

```ts
import { resolutionPresets, sourcePreset } from '@whatworks/payload-video-webm'

presets: {
  ...resolutionPresets([360, 720]), // delivery sizes first
  ...sourcePreset(),                // full-resolution copy last
}
```

mp4 → WebM is **always** a re-encode: WebM carries only VP8/VP9/AV1 video and Opus/Vorbis audio, so an H.264 stream can't simply be remuxed into it. "Unchanged" here means nothing is resized, cropped or dropped and the quality target is high enough to be indistinguishable in normal viewing — not bit-identical. If you genuinely want mathematically lossless VP9:

```ts
sourcePreset({ extraArgs: ['-lossless', '1'] })
```

expect a file several times larger than the mp4, which `skipIfLarger` will then usually refuse to store. Overrides otherwise work as you'd expect — `sourcePreset({ crf: 24 })` trades a little quality for size.

Because it sets no height cap, this preset never counts as a redundant rung, so pairing it with ladder heights at or above your typical source resolution will encode the same frame size twice at different qualities.

Preset advanced needs (crop filters, stripping audio, …) go through each preset's `encoding.extraArgs` — raw ffmpeg output args with the same last-one-wins caveats as everywhere else. The job encodes presets sequentially under the concurrency limiter and is **idempotent per preset**: a retry after a partial failure resumes the missing renditions instead of duplicating finished ones.

Two guards decide a preset isn't worth storing, and **both record their decision** on the document so no later run pays for the same encode twice:

- `skipIfLarger` (default on) — the WebM lost to the source, so the source stands alone.
- `skipRedundantPresets` (default on) — the source is too small to fill the rung. Since nothing ever upscales, a 480p master under `resolutionPresets([360, 720, 1080])` would encode `1080p` into a second copy of `720p`; only the first rung at or above the source height is encoded and the rest are marked `source-smaller`. Costs one `ffmpeg -i` probe per job, only applies to presets that set `maxHeight`, and skips nothing if the probe can't read the dimensions.

Either way the rendition is simply absent and the frontend helpers fall back — and the sidebar panel shows the preset with the reason instead of a size.

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

  // How the job gets the source video. Return a Buffer, or `{ filePath }` to keep
  // it off the heap entirely. Default: the collection's staticDir read in place for
  // local storage, else streaming doc.url (against serverURL) to a temp file.
  // Override for access-controlled storage the default can't reach.
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

  // Skip ladder rungs the source is too small to fill (nothing ever upscales, so
  // they'd duplicate a smaller rung). Costs one ffmpeg probe per job. Default true.
  skipRedundantPresets: true,

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

## The admin panel and the `videoWebm` metadata group

The document sidebar gets a single **WebM conversion** control panel (a `ui` field pointing at `@whatworks/payload-video-webm/client#WebmConversionPanel`):

- **Live status** — while the job runs it polls every 2.5s and flips in place from _Optimising…_ to the result, no refresh needed; failures and skips are explained inline.
- **Condensed rendition table** — one row per preset, labelled with the preset's `label`, showing its file size and % saved (no filenames cluttering the sidebar), an **Open ↗** action that opens the video file in a new tab, and a **↺ regenerate** action per row (plus **↺ all** in the header). Presets the job deliberately didn't store show their reason instead of a size.
- **Regenerate** drops the rendition(s) and re-queues the background job, so the file is re-encoded with the _current_ plugin config — change `presets`/`crf` in your config, hit ↺, and the new quality applies. Gated by the collection's own `update` access control via `POST /api/<taskSlug>/regenerate` `{ collection, id, preset? }` (also callable from your own tooling).

- **Recovery** — the header action stays available while a conversion is queued, which is how you restart a run that was killed mid-encode (see "The cron safety net"). A conversion that is genuinely still running is refused with `409` rather than piled onto.

The underlying `videoWebm` status group and `webmVersions` array are hidden in the admin (the panel presents them) but remain fully readable through the API. `metadataFields: false` removes the group and the panel; conversions still happen.

### The `videoWebm` metadata group

Every targeted collection gets a read-only sidebar group (opt out with `metadataFields: false`), hidden in the admin until the plugin recorded something:

| Field              | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `status`           | `queued` → `complete` \| `skipped` \| `failed`. Stamped `queued` at upload time.   |
| `originalFilename` | The source filename, e.g. `clip.mp4`.                                              |
| `originalMimeType` | The source mime type, e.g. `video/mp4`.                                            |
| `originalFilesize` | Source size in bytes — compare with the sidecar's `filesize` for the savings.      |
| `encodeDurationMs` | Wall-clock ffmpeg time for the successful encode.                                  |
| `skippedReason`    | `input-too-large` (at upload time), or `output-larger` / `source-smaller` (job).   |
| `error`            | Last job error, truncated — retries may still flip the status to `complete` later. |

The group is stamped only on requests that actually carry a file, so re-saving a document never clobbers the record, while replacing the file resets it (and queues a fresh conversion). `metadataFields: false` removes the group and the panel; conversions still run — the queue is driven by the request, not by the stamped status.

Per-preset outcomes live in `webmVersions` rather than in this group: every row is either a stored rendition (`{ preset, video }`) or a recorded skip (`{ preset, skippedReason }`).

## Derivatives are real documents

The renditions are ordinary documents in the same collection — that is exactly what keeps them on whatever storage adapter the collection already uses — flagged with a hidden `isWebmDerivative` checkbox. The plugin hides them from the **admin list view** via `baseListFilter`, and that is the only place Payload applies such a filter. Everywhere else you have to exclude them yourself, which is one import:

```ts
import { EXCLUDE_WEBM_DERIVATIVES } from '@whatworks/payload-video-webm'

// Your own queries — otherwise totalDocs and pagination count the renditions too.
await payload.find({ collection: 'media', where: EXCLUDE_WEBM_DERIVATIVES })

// Every relationship/upload field pointing at a converted collection — without this
// the picker offers editors clip.mp4, clip-360p.webm, clip-720p.webm and clip-1080p.webm.
{ name: 'hero', type: 'upload', relationTo: 'media', filterOptions: EXCLUDE_WEBM_DERIVATIVES }
```

The same applies to REST/GraphQL list endpoints and to `count`. Access control is inherited from the collection: anyone who can read a source document can read its renditions.

### Drafts, versions and duplicates

- **Versioned collections work**, with one caveat: the job's bookkeeping write goes through `payload.update`, so on a drafts-enabled collection it creates a version like any other update. Restoring an old version can't destroy renditions — the cleanup only runs for writes that actually retire them (a new file, the job itself, or the regenerate endpoint), never for a stale snapshot of `webmVersions`.
- **Duplicating a document** gives the copy a clean slate rather than a shared one: Payload never sets `req.file` when duplicating, so the copy starts unconverted (its panel offers **Convert**) instead of inheriting rows that point at the original's renditions.

## How it works

1. **Upload time** (`beforeChange`): the cheap guards run against the client-declared `req.file.mimetype` (no content sniffing), `maxInputFileSize`, and your `shouldConvert` predicate. Candidates are stamped `status: 'queued'`; `req.file` is never touched, so the source stores byte-for-byte as uploaded.
2. **After the write** (`afterChange`): a durable job row is queued — deliberately without `req`, so the row isn't trapped inside the request's transaction — and handed to `dispatch`, along with the document's `webmGeneration` counter, which the stamp hook has just bumped. The response returns.
3. **In the job**: the handler re-reads the document and bails unless it is still the one that was queued — same file, same generation. It then puts the source on disk (local storage is read in place; remote storage is streamed to a temp file, never buffered), probes its dimensions, and encodes each undecided preset under the concurrency limiter. Every rendition is a hidden sidecar document in the same collection, linked as a `{ preset, video }` row in `webmVersions`.
4. **On the way out**: the document is read _again_ and this run's rows are merged onto it, so a slow run can't overwrite renditions that were created or retired while it worked; if the generation moved on, the run discards its own output instead. Failures link whatever finished, record `status: 'failed'`, and rethrow so Payload's retries resume the missing presets.

**Lifecycle guarantees**: replacing the document's file queues a re-encode of every preset and garbage-collects the stale renditions; replacing a video with a non-video clears everything; deleting the original deletes all its renditions, in the same transaction as the delete. Renditions are only ever collected by writes that genuinely retire them, so an ordinary save or a restored version can't take live files down with it. A rendition deleted behind the plugin's back is noticed and re-encoded on the next run. Other document fields are copied onto the sidecar so required fields validate; collections with `unique` non-upload fields will conflict on sidecar creation, so avoid targeting those.

**Concurrency**: two runs of the same conversion (the immediate run racing cron, or two retries) are serialised in-process by a per-document lock, and across processes the generation check plus the merged final write make the loser harmless — it deletes its own duplicate renditions rather than leaving them orphaned.

**Hook ordering**: the plugin's hooks are appended after any hooks the collection already declares, and since nothing mutates `req.file`, your hooks always see the original upload. The sidecar arrives later as its own document create, which runs your collection hooks too — check `isWebmDerivative` in your hooks if you need to tell them apart.

## Performance and cost

- Storage is source + one WebM per preset — that's the point: the source is never sacrificed, and optimised versions can be regenerated at any time. A full ladder multiplies encode time and storage accordingly; start with the sizes your players actually use.
- VP9 is CPU-intensive. `maxConcurrentEncodes` (default 2, per process) stops simultaneous uploads from stampeding the encoder; for real volume, move the queue to a dedicated `payload jobs:run` container.
- `maxInputFileSize` keeps oversized masters out of the encoder entirely; `skipIfLarger` (default on) refuses to store a WebM that lost to the original; `skipRedundantPresets` (default on) refuses to encode a ladder rung the source can't fill.
- **Memory**: source videos are never held in memory — ffmpeg reads them from disk, and remote storage is streamed to a temp file. Each _stored_ rendition is read into a buffer once to hand to Payload's upload pipeline, so peak usage tracks output size, not input size. Temp directories are removed in `finally`, timeouts included.
- Encodes are only queued by writes that pass access control, and the regenerate endpoint refuses to stack a second conversion onto a document whose conversion is still in flight.
- Client-side uploads that bypass the Payload server (`upload.clientUploads`, presigned flows) never trigger the `afterChange` hook and are not converted.

## Scope

This plugin is deliberately WebM-only: `webmVersions`, `isWebmDerivative` and the `video/webm` output are part of its stored schema, not placeholders for a general transcoding pipeline. Other output formats (MP4/AV1 fallbacks, poster frames, audio-only) are out of scope and would arrive as a separate package rather than a schema migration here.

## Development and testing

The dev sandbox (`pnpm dev`) boots a Payload admin backed by SQLite with a `media` collection wired to the plugin — upload an mp4/mov, watch the response return immediately, then refresh to see `status` flip to `complete` with the `WebM version` link. Tests (`pnpm test`) generate video fixtures with your local ffmpeg; the encode-dependent suite skips automatically when no binary is installed, while jobs plumbing, process handling, and failure modes are exercised with stand-in binaries and run everywhere.

# @whatworks/payload-video-optimizer

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-video-optimizer" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Payload plugin that turns video uploads into **WebM (VP9 + Opus)** in the background, at a range of sizes, so your frontend serves each visitor a file that fits their screen instead of one big file for everyone.

Your original upload is **never touched**. Every optimised version is a separate hidden document, created by a durable background job after the upload response has already returned.

- **Uploads stay fast** — the editor's upload returns as soon as the file is stored. Encoding happens afterwards.
- **A ladder of sizes, by default** — six widths from 2560px down to 426px, so a phone doesn't download a file made for a desktop.
- **The frontend picks the right one for free** — one line of config per video slot, generated for you by a CLI that measures your actual page.
- **The original is never replaced or deleted** — every optimised version can be regenerated at any time.
- **Live admin panel** — shows progress while the job runs, then file sizes, savings, and one-click regeneration.
- **Zero runtime dependencies** — spawns the `ffmpeg` binary directly. No Redis, no external workers, no wrapper libraries.

---

## Quick start

### 1. Install

```sh
pnpm add @whatworks/payload-video-optimizer
```

### 2. Add the plugin

```ts
import { videoOptimizerPlugin } from '@whatworks/payload-video-optimizer'
import { after } from 'next/server'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    videoOptimizerPlugin({
      // How your platform runs background work (see "Dispatch" below).
      dispatch: (_job, { run }) => after(run), // Next.js on Vercel
    }),
  ],
})
```

Then regenerate the import map so the admin can find the plugin's status panel:

```sh
payload generate:importmap
```

### 3. Upload a video

Upload an mp4 or mov. The response returns immediately, the sidebar shows **Optimising…**, and it fills itself in when the job finishes — no refreshing.

You now have your original file plus up to six WebM versions of it at different widths.

### 4. Show it on your frontend

```tsx
import { getVideoSourceSet } from '@whatworks/payload-video-optimizer/frontend'
;<video controls playsInline>
  {getVideoSourceSet(media, { sizes: '100vw' }).map(({ media: query, src, type }) => (
    <source key={src + query} media={query} src={src} type={type} />
  ))}
</video>
```

`sizes: '100vw'` means _"this video is displayed as wide as the browser window"_. If that's true for your layout, you're done. If it isn't, the next section explains what to put there instead — and how to have it written for you.

> **One gotcha that bites silently:** query one level deeper than you think. See [Query deep enough](#query-deep-enough).

---

## Showing videos on your frontend

This is the part worth reading properly. It's short, and it starts from zero.

### The problem, in plain terms

A video file has a fixed pixel width baked into it. A 2560px-wide file shown in a 400px-wide box on a phone still downloads every one of those pixels — around **40× the data** actually needed — and then throws them away.

So the plugin makes the same video at several widths:

| Rendition | Pixel width | Roughly good for                                |
| --------- | ----------- | ----------------------------------------------- |
| `2560w`   | 2560        | full-screen on a retina laptop                  |
| `1920w`   | 1920        | full-screen on a normal desktop                 |
| `1280w`   | 1280        | a large column, or full-screen on a phone at 2× |
| `854w`    | 854         | a half-width block                              |
| `640w`    | 640         | a card in a grid                                |
| `426w`    | 426         | a thumbnail                                     |

Each rung is about half the file size of the one above it. Now something has to pick.

### Why the browser can't just work it out

For images, you may have seen this:

```html
<img srcset="hero-640.jpg 640w, hero-1280.jpg 1280w" sizes="100vw" />
```

That `sizes` attribute is you telling the browser **how wide the image will be on the page**. It feels redundant — surely the browser can see its own layout? — but it can't, not at the moment it has to choose. Images start downloading from a quick scan of the raw HTML, before the CSS has even arrived, let alone been applied. By the time layout exists, the download should already be in flight. So the author states the answer up front.

`<video>` never got `srcset`/`sizes` at all. It only has `media` queries on each `<source>`, and the browser takes the **first source it can play** — not the best-sized one.

So this plugin does that same arithmetic for you, at render time. You supply one thing: **how wide the video is on the page.**

### `sizes`: how wide is your video?

`sizes` is a comma-separated list, read left to right, and **the first match wins**:

```
(min-width: 1024px) 800px, 100vw
```

Read it as: _"once the window is at least 1024px wide, the video is 800px wide. Otherwise it's the full window width."_

Three kinds of value are allowed:

| You write           | It means                               |
| ------------------- | -------------------------------------- |
| `400px`             | the video is always 400px wide here    |
| `50vw`              | the video is half the window width     |
| `calc(50vw - 24px)` | half the window, minus 24px of padding |

Two rules, and they're the only ways to get this wrong:

1. **Widest first.** The first match wins, so `(min-width: 1024px)` must come before `(min-width: 640px)`.
2. **End with a plain value and no condition** — the fallback for narrow windows.

That's the entire syntax. Nothing about phones, retina screens, or file sizes: **device pixel ratio is handled for you.** You describe your CSS, the plugin handles the device.

### Don't write it by hand — generate it

Getting `sizes` exactly right by reading your own stylesheet is harder than it looks, and being wrong is silent: the video just looks soft, or quietly wastes bandwidth. So measure it instead.

With your dev server running:

```sh
pnpm add -D playwright && pnpm exec playwright install chromium

pnpm exec payload-video-sizes http://localhost:3000/blog --selector "[data-slot=card]"
```

```
sweeping 320 → 2560px … 148 samples, 4 segments found

  (min-width: 1200px) 368px, (min-width: 1024px) calc(33.333vw - 32px), (min-width: 640px) calc(50vw - 36px), calc(100vw - 48px)

⚠ 1200px is a max-width plateau, not a media query — easy to miss by hand.
```

It loads the page, resizes the window across the whole range, measures your element at each width, and works out the formula. Paste the line into your component:

```tsx
// app/blog/VideoCard.tsx
const SIZES =
  '(min-width: 1200px) 368px, (min-width: 1024px) calc(33.333vw - 32px), (min-width: 640px) calc(50vw - 36px), calc(100vw - 48px)'

export const VideoCard = ({ media }) => (
  <video data-slot="card" controls playsInline>
    {getVideoSourceSet(media, { sizes: SIZES }).map(({ media: query, src, type }) => (
      <source key={src + query} media={query} src={src} type={type} />
    ))}
  </video>
)
```

That's the whole workflow. Run it once when you build the component; it rarely changes after that.

Note the warning in the output. `1200px` appears nowhere in that project's CSS — it's where a `max-width: 1200px` container stops growing, so the card stops growing too. It's a real breakpoint for sizing purposes and it's invisible if you're working from your list of media queries. Measuring finds it; reading your stylesheet doesn't.

### Catching it when your layout changes

The `sizes` string is now a constant in your source. Change the grid from three columns to four and it's wrong — silently. Add one test:

```ts
import { expectSizesAccurate } from '@whatworks/payload-video-optimizer/sizes-devtools'

import { SIZES } from '@/app/blog/VideoCard'

test('blog card sizes stays accurate', async ({ page }) => {
  await page.goto('/blog')
  await expectSizesAccurate(page, '[data-slot=card]', { sizes: SIZES })
})
```

```
✗ at 1280px the slot measures 272px, but sizes predicts 368px
  → serving 854w where 640w is right (37 viewport/dpr combinations affected)
  current:  (min-width: 1200px) 368px, …
  measured: (min-width: 1200px) 276px, …
```

It only fails when the difference actually changes which file gets served — a few pixels out inside one rung's range is harmless and ignored.

### Videos that change shape

`object-fit: cover` handles most shape mismatches for free: a 16:9 video in a 4:3 box just has a bit cropped off by the browser, costing you around 1.3× the pixels. Not worth a separate file.

Portrait is the exception. A landscape video in a full-screen phone slot downloads roughly **3.2×** the pixels it shows. So the plugin can make cropped 9:16 versions:

```ts
videoOptimizerPlugin({ portrait: true }) // adds 1080w and 720w 9:16 renditions
```

The crop takes the tallest 9:16 window that fits, positioned by the document's **focal point** (Payload's own `focalX`/`focalY`), so the subject stays in frame.

Then tell the frontend where your slot changes shape, using the same grammar with ratio values:

```tsx
getVideoSourceSet(media, {
  sizes: '(min-width: 768px) 1200px, 100vw',
  aspect: '(min-width: 768px) 16/9, 9/16', // wide on desktop, portrait on mobile
})
```

Only reach for `aspect` when your slot genuinely changes shape _and_ you've enabled `portrait`. Without it every size stays on the video's original framing, which is usually what you want — a crop is an editorial decision, not a smaller file.

> A focal point can't rescue a subject sitting right at the edge of the frame. Check your masters before relying on portrait crops for faces.

### Query deep enough

The optimised versions are separate documents, so reaching them costs one more relationship hop than you'd expect:

| Your query                                | Gets the video | Gets its renditions             |
| ----------------------------------------- | -------------- | ------------------------------- |
| `find({ collection: 'media', depth: 1 })` | —              | ✅                              |
| `find({ collection: 'pages', depth: 1 })` | ✅             | ❌ — **the original is served** |
| `find({ collection: 'pages', depth: 2 })` | ✅             | ✅                              |

At too shallow a depth everything still _works_ — the helpers fall back to the original file and the optimisation quietly does nothing. In development they log a warning saying exactly that.

`populate` is worth using here — renditions only need a few fields — but it has two traps, and both fail silently. These four keys are the minimum:

```ts
await payload.find({
  collection: 'pages',
  depth: 2,
  populate: {
    media: {
      renditions: true, // the renditions themselves
      filename: true, // `url` is virtual and computed from this
      url: true,
      mimeType: true, // the <source> type attribute
      // …plus whatever your own components read, e.g. `alt`.
    },
  },
})
```

`populate` is keyed by **collection slug** and is a strict **allowlist**: any field you don't name is absent from the result.

- **Omit `renditions`** and the video comes back with no renditions attached. The helpers fall back to the original file and the optimisation quietly does nothing — the same failure as querying too shallow, from a query that looks deliberate.
- **Omit `filename`** and it's worse. `url` is a virtual field Payload computes from `filename`, so naming `url` without it returns `url: null` on the source _and_ on every rendition — and you get no `<source>` elements at all, not even the original.

The same list also governs the renditions, because a rendition _is_ a `media` document — which is why `filename`, `url` and `mimeType` have to be in it. Each row's `width`/`height` live on `renditions` itself, so you don't need to name those for selection to work.

### Other ways to choose

`getVideoSourceSet` needs no JavaScript and works with static rendering, but browsers pick a video source **once, at load** — nothing swaps on resize or rotation. Two alternatives:

**Measure the slot yourself** — exact, and re-evaluates:

```tsx
const variant = pickVideoVariant(media, { dpr: devicePixelRatio, height, width })
<video src={variant?.src ?? media.url} />
```

Pass a `height` too and it also picks the shape, switching to a cropped rendition only when covering with the original shape would overdraw more than 2×. Feed it a `ResizeObserver` and re-key the `<video>` to swap on rotation.

**Don't choose at all:**

```tsx
getVideoSources(media).map((s) => <source key={s.src} src={s.src} type={s.type} />)
```

Every rendition in order, with the original appended last, so **something always plays** — before the job finishes, for skipped conversions, and in browsers without WebM support alike. The browser takes the first it can play, which is your first-declared preset for every visitor. Fine for small, uniform slots.

`getVideoVariants(media)` returns the renditions with their measured dimensions if you'd rather write your own picker. And `getRenditionUrl(media, '720p') ?? media.url` gets you a single URL by name.

**The plugin deliberately ships no `<Video />` component.** Choosing the file is the hard, reusable part and it's above; markup, posters, and CSS belong in your codebase where you can style them.

---

## The admin panel

Each document gets a **WebM conversion** panel in the sidebar:

- **Live status** — polls every 2.5s while the job runs and flips in place from _Optimising…_ to the result. Failures and skips are explained inline.
- **A row per stored rendition** — its label, file size and % saved, an **Open ↗** action, and a **↺** to regenerate just that one. Renditions the job decided not to store collapse into one muted footnote saying why, so a missing size reads as a decision rather than a failure.
- **↺ all** — drops every rendition and re-queues the job, so files are re-encoded against your _current_ config. Change `presets` or `quality`, hit ↺, and the new settings apply.

Regeneration is gated by the collection's own `update` access control, via `POST /api/<taskSlug>/regenerate` with `{ collection, id, preset? }` — callable from your own tooling too.

---

## Compatibility

| Requirement | Supported                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payload     | `>=3.54.0 <4` (peer dependency; uses the built-in Jobs Queue)                                                                                                                              |
| Node.js     | `>=20.9.0`                                                                                                                                                                                 |
| ffmpeg      | Any build with `libvpx`/`libvpx-vp9` and `libopus` — every standard distribution build (apt, brew, static builds, [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)) has them |
| OS          | Linux and macOS (anywhere `ffmpeg` can be spawned); Windows should work but is untested                                                                                                    |

ffmpeg is only needed by the **process that runs the jobs**. It looks for `ffmpeg` on `PATH`, or wherever `FFMPEG_PATH` / the `ffmpeg.path` option points. At boot the plugin checks the binary is executable **and** that the required encoders are compiled in, warning otherwise.

---

## Configuration

Everything is optional except `dispatch`.

```ts
videoOptimizerPlugin({
  // ── The one thing to get right in production ──────────────────────────────
  // How your platform runs work after the response. See "Dispatch" below.
  dispatch: (_job, { run }) => after(run),

  // ── Common ────────────────────────────────────────────────────────────────
  // Which upload collections to convert. Defaults to all of them.
  collections: ['media'],

  // Also make 9:16 crops for portrait slots. Off by default.
  portrait: true, // or { widths: [1080] }

  // Shift every rendition's quality. 'high' | 'balanced' (default) | 'small'.
  quality: 'balanced',

  // Kill switch: false leaves the Payload config completely untouched.
  enabled: true,

  // ── Renditions ────────────────────────────────────────────────────────────
  // Defaults to widthPresets() — 2560w, 1920w, 1280w, 854w, 640w, 426w.
  presets: widthPresets([1920, 1280, 640]),

  // Settings shared by every rendition. Most people only touch `audio`.
  encoding: {
    audio: true, // false passes -an: a muted background loop shouldn't carry audio
    crf: 32, // 0-63, lower = better quality and a bigger file
    maxWidth: 1920, // cap dimensions; smaller sources are never upscaled
    maxHeight: 1080,

    // Advanced ffmpeg knobs — you can almost certainly ignore these.
    aspectRatio: '9:16', // crop before scaling, framed by the focal point
    codec: 'vp9', // 'vp9' (default) or 'vp8'
    speed: 2, // -cpu-used: 0 slowest/best … 5 (VP9) / 16 (VP8) fastest
    audioBitrate: '128k',
    pixelFormat: 'yuv420p', // null keeps the source format
    videoBitrate: '0', // '0' for VP9 (pure CRF), '1M' ceiling for VP8
    extraArgs: ['-an'], // raw output args, appended last
  },

  // ── Guards (all sensible by default) ──────────────────────────────────────
  skipIfLarger: true, // don't store a WebM that lost to the source
  skipRedundantPresets: true, // don't encode rungs the source is too small to fill
  maxInputFileSize: 500 * 1024 * 1024, // don't queue conversions above this size

  // Which uploads count as video, matched against the client-declared mime type.
  // 'video/*' wildcards work. video/webm is always left alone.
  inputMimeTypes: ['video/mp4', 'video/quicktime'],

  // ── Rarely touched ────────────────────────────────────────────────────────
  ffmpeg: {
    path: '/usr/bin/ffmpeg', // defaults to FFMPEG_PATH or `ffmpeg` on PATH
    maxConcurrent: 2, // simultaneous encodes per Node process; null = unlimited
    timeoutMs: 10 * 60 * 1000, // per encode, not per job
  },
  jobs: {
    queue: 'video-conversion',
    retries: 3,
    taskSlug: 'video-convert', // only matters with two plugin instances
  },

  // Inject the read-only sidebar panel and metadata group. Default true.
  metadataFields: true,

  // ── Escape hatches ────────────────────────────────────────────────────────
  // Veto individual conversions at upload time, after every guard above passed.
  shouldConvert: ({ collection, file, req }) => !file.name.includes('raw'),

  // Supply the source video to the job yourself — for access-controlled storage
  // the default (staticDir, else streaming doc.url) can't reach. Return a Buffer,
  // or { filePath } to keep it off the heap.
  fetchSource: async ({ doc }) => myBucket.get(String(doc.filename)),

  // Called after every conversion decision on a candidate video.
  onConversionComplete: (outcome) => {
    console.log(outcome.collection, outcome.originalFilename, outcome.converted)
  },
})
```

`collections` also takes an object, where `true` inherits the plugin settings and an object overrides them per collection (`encoding` merges key by key):

```ts
collections: {
  media: true,
  videos: { encoding: { crf: 30 }, portrait: true },
}
```

Unknown or non-upload slugs throw at init, so typos surface immediately. `dispatch`, `enabled`, `ffmpeg` and `jobs` are plugin-wide and can't be set per collection.

---

## Advanced

### Dispatch — how conversions get off the request

The plugin can't know what platform it's on, so you say how to defer the work:

```ts
dispatch: (_job, { run }) => after(run) // Next.js on Vercel
dispatch: (_job, { run }) => waitUntil(run()) // Cloudflare Workers
dispatch: (_job, { run }) => void run() // long-running Node server
dispatch: (job) => qstash.publishJSON({ body: job }) // external queue
dispatch: 'inline' // deliberately block the upload
```

`job` is serialisable (`{ collection, docId, generation, jobId, sourceFilename }`) for hosts with real queue infrastructure. `run` executes the queued row in-process via `payload.jobs.runByID`, waiting first for the upload's transaction to commit so the job can actually see the document.

**When `dispatch` is unset** the plugin runs the job itself and warns at boot. What that means depends on your database:

| Database                                    | Without `dispatch`                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No transactions (Mongo standalone, SQLite)  | The job runs **inline** — `payload.create()` resolves only once the encode is done.                                           |
| Transactions (Postgres, Mongo replica sets) | The job starts **detached** after the upload commits, because awaiting it inside the hook would deadlock against that commit. |

The detached case is exactly where a platform that freezes after the response can lose the run, so **configure `dispatch` (or a jobs runner) in production**. The durable row survives either way. Pass `dispatch: 'inline'` if you genuinely want the upload to block and would rather not see the warning.

### The cron safety net

A durable row means an interrupted conversion isn't lost — with one limit. Payload marks a job `processing` the moment it starts and has no lease or stall recovery, so:

- **Never-started and cleanly-failed rows** (an external-queue `dispatch`, an encode that threw, retries still pending) are picked up by cron. This is the guarantee.
- **A run killed mid-encode** (SIGKILL, a frozen serverless instance) leaves its row claimed. Cron won't re-run it and the document stays `queued`. The fix is one click of **↺ all** — it queues a _fresh_ job, and per-preset idempotency means only what's missing gets encoded.

Run the queue on a schedule, either through Payload's autorun:

```ts
jobs: {
  autoRun: [{ cron: '*/5 * * * *', queue: 'video-conversion' }],
}
```

or an external cron hitting `GET /api/payload-jobs/run?queue=video-conversion`, or `payload jobs:run --queue video-conversion` in a worker container. That last shape is also the answer to ffmpeg's ~80 MB weight on serverless: keep the web app ffmpeg-free (it only writes queue rows and serves uploads) and run the jobs in a container that carries ffmpeg, pointed at the same database.

### Presets

Each preset is a named encoding override, merged over `encoding`, and each becomes its own sidecar document with a suffixed filename (`clip-720p.webm`). Declaration order is preference order.

```ts
videoOptimizerPlugin({
  encoding: { audioBitrate: '96k' }, // shared
  presets: {
    '720p': { label: '720p HD', encoding: { maxHeight: 720, crf: 32 } },
    '360p': { label: '360p Mobile', encoding: { maxHeight: 360, crf: 36 } },
  },
})
```

Two ready-made builders save you writing them out. `widthPresets()` is the default and builds a width ladder ~1.5× apart:

```ts
import { widthPresets } from '@whatworks/payload-video-optimizer'

presets: widthPresets() // 2560w, 1920w, 1280w, 854w, 640w, 426w
presets: widthPresets([1920, 1280, 640]) // just three
```

Widths suit layout work because a slot is measured by how wide it is. File size tracks pixel count and pixel count is width squared, so each rung is roughly half the bytes of the one above. Closer spacing buys a few percent per request for a whole extra encode; wider spacing (2×) leaves gaps where a 1000px slot gets either a soft 640 or a wasteful 1280.

`resolutionPresets()` is the height-based equivalent, if you think in `720p`:

```ts
import { resolutionPresets } from '@whatworks/payload-video-optimizer'

presets: resolutionPresets([360, 720, 1080])
// → { '360p': …crf 36, '720p': …crf 32, '1080p': …crf 31 }
```

Both take their per-rung CRF from Google's published VP9 recommendations, by pixel count — so a 9:16 crop 1080px wide (1080×1920) gets the same quality as a 1920×1080 landscape rung, which has exactly the same number of pixels.

**Six encodes sounds like a lot, and isn't.** Cost tracks pixel count, so on a 4K master the whole ladder is 7.4 megapixels against 8.3 for a single uncapped encode of the source — the ladder is _cheaper_ than converting the file once at its own resolution. The bottom four rungs together are about 10% of the job. And smaller sources encode fewer rungs automatically: a 1080p master does five, a 720p master four.

### Aspect-ratio crops beyond portrait

`portrait: true` covers the case that matters. For anything else, `widthPresets` takes a ratio directly:

| Slot shape     | Overdraw with `cover` | Worth an encode? |
| -------------- | --------------------- | ---------------- |
| 21:9 ultrawide | 1.3×                  | no               |
| 4:3            | 1.3×                  | no               |
| 1:1 square     | 1.8×                  | no               |
| 9:16 portrait  | **3.2×**              | yes              |

```ts
presets: {
  ...widthPresets(),
  ...widthPresets([1080, 720], { aspectRatio: '1:1' }), // → 1x1-1080w, 1x1-720w
}
```

The prefix defaults to a slug of the ratio, so cropped ladders can't collide with the landscape ones. Pass `prefix` to name them yourself.

The crop takes the largest window of that shape which fits, positioned by the document's focal point (centred if the collection has none) and clamped so it can never run off an edge. Cropping happens before scaling, and both sides stay even for the 4:2:0 chroma grid. It's expressed in ffmpeg's own filter expressions rather than computed from probed dimensions, so the framing is right even for rotated phone footage.

Portrait widths look small but aren't: a 9:16 file at 1080 wide is 1080×1920 — 2.07 MP, exactly as many pixels as a 1920×1080 landscape file. Same cost, same encode time; only the shape rotated.

### When a rendition isn't stored

Two guards decide a preset isn't worth keeping, and **both record their decision** so no later run pays for the same encode twice:

- `skipIfLarger` (default on) — the WebM lost to the source, so the source stands alone.
- `skipRedundantPresets` (default on) — the source is too small to fill the rung. Nothing ever upscales, so a 480p master under a `1080p` rung would just produce a second copy of `720p`. Only the first rung at or above the source is encoded; the rest are marked `source-smaller`. Presets capping `maxWidth` or `maxHeight` take part, each aspect ratio judged against its own crop window; uncapped presets always encode. Costs one `ffmpeg -i` probe per job, and skips nothing if the probe can't read the dimensions.

Either way the rendition is simply absent, the frontend helpers fall back, and the sidebar shows the reason instead of a size.

### The `videoConversion` metadata group

Every targeted collection gets a read-only sidebar group (opt out with `metadataFields: false`), hidden until the plugin records something:

| Field              | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `status`           | `queued` → `complete` \| `skipped` \| `failed`. Stamped `queued` at upload time. |
| `originalFilename` | The source filename, e.g. `clip.mp4`.                                            |
| `originalMimeType` | The source mime type.                                                            |
| `originalFilesize` | Source size in bytes — compare with a rendition's `filesize` for the savings.    |
| `encodeDurationMs` | Wall-clock ffmpeg time for the successful encode.                                |
| `skippedReason`    | `input-too-large` (upload time), or `output-larger` / `source-smaller` (job).    |
| `error`            | Last job error, truncated — retries may still flip the status to `complete`.     |

The group is stamped only on requests that actually carry a file, so re-saving a document never clobbers it, while replacing the file resets it and queues a fresh conversion.

Per-preset outcomes live in `renditions`: each row is either a stored rendition or a recorded skip. Dimensions are measured off each encoded file — Payload only derives width/height for images — so picking a rendition by width costs no extra query:

```ts
{
  filename: 'hero.mp4',
  renditions: [
    { preset: '1280w',          width: 1280, height: 720,  video: { url: 'https://cdn/…/hero-1280w.webm' } },
    { preset: '640w',           width: 640,  height: 360,  video: { url: 'https://cdn/…/hero-640w.webm' } },
    { preset: 'portrait-1080w', width: 1080, height: 1920, video: { url: 'https://cdn/…/hero-portrait-1080w.webm' } },
    { preset: '2560w',          skippedReason: 'source-smaller' },
  ],
}
```

That array is embedded on a document your page query already fetches, and the URLs point straight at the collection's storage adapter, so rendering costs no extra database work and video bytes never pass through your origin.

### Purging caches when a rendition lands

A conversion finishing changes a document your pages already rendered. `onConversionComplete` is the hook for that — in Next.js:

```ts
onConversionComplete: async ({ collection, docId }) => {
  revalidateTag(`${collection}-${docId}`)
}
```

Tag the fetches that read the video with the same key and a finished encode purges exactly the routes using it.

### Renditions are real documents

They're ordinary documents in the same collection — which is what keeps them on whatever storage adapter the collection already uses — flagged with a hidden `isVideoDerivative` checkbox. The plugin hides them from the **admin list view** via `baseListFilter`, and that's the only place Payload applies such a filter. Everywhere else you exclude them yourself, which is one import:

```ts
import { EXCLUDE_VIDEO_DERIVATIVES } from '@whatworks/payload-video-optimizer'

// Your own queries — otherwise totalDocs and pagination count the renditions too.
await payload.find({ collection: 'media', where: EXCLUDE_VIDEO_DERIVATIVES })

// Every relationship/upload field pointing at a converted collection — without this
// the picker offers editors clip.mp4, clip-640w.webm, clip-1280w.webm and the rest.
{ name: 'hero', type: 'upload', relationTo: 'media', filterOptions: EXCLUDE_VIDEO_DERIVATIVES }
```

The same applies to REST/GraphQL list endpoints and to `count`. Access control is inherited: anyone who can read a source document can read its renditions.

### Drafts, versions and duplicates

- **Versioned collections work**, with one caveat: the job's bookkeeping write goes through `payload.update`, so on a drafts-enabled collection it creates a version like any other update. Restoring an old version can't destroy renditions — cleanup only runs for writes that actually retire them (a new file, the job itself, or the regenerate endpoint), never for a stale snapshot of `renditions`.
- **Duplicating a document** gives the copy a clean slate: Payload never sets `req.file` when duplicating, so the copy starts unconverted (its panel offers **Convert**) rather than inheriting rows pointing at the original's renditions.

### How it works

1. **Upload time** (`beforeChange`): cheap guards run against the client-declared `req.file.mimetype` (no content sniffing), `maxInputFileSize`, and your `shouldConvert` predicate. Candidates are stamped `status: 'queued'`; `req.file` is never touched, so the source stores byte-for-byte as uploaded.
2. **After the write** (`afterChange`): a durable job row is queued — deliberately without `req`, so the row isn't trapped inside the request's transaction — and handed to `dispatch`, along with the document's `renditionGeneration` counter. The response returns.
3. **In the job**: the handler re-reads the document and bails unless it's still the one that was queued — same file, same generation. It puts the source on disk (local storage is read in place; remote storage is streamed to a temp file, never buffered), probes its dimensions, and encodes each undecided preset under the concurrency limiter. Every rendition becomes a hidden sidecar document linked as a `{ preset, video }` row.
4. **On the way out**: the document is read _again_ and this run's rows merged onto it, so a slow run can't overwrite renditions created or retired while it worked; if the generation moved on, the run discards its own output. Failures link whatever finished, record `status: 'failed'`, and rethrow so Payload's retries resume the missing presets.

**Lifecycle guarantees**: replacing the file queues a re-encode of every preset and garbage-collects the stale renditions; replacing a video with a non-video clears everything; deleting the original deletes all its renditions in the same transaction. Renditions are only collected by writes that genuinely retire them, so an ordinary save or a restored version can't take live files down. A rendition deleted behind the plugin's back is noticed and re-encoded on the next run. Other document fields are copied onto the sidecar so required fields validate; collections with `unique` non-upload fields will conflict on sidecar creation, so avoid targeting those.

**Concurrency**: two runs of the same conversion (the immediate run racing cron, or two retries) are serialised in-process by a per-document lock, and across processes the generation check plus the merged final write make the loser harmless — it deletes its own duplicate renditions rather than leaving them orphaned.

**Hook ordering**: the plugin's hooks are appended after any the collection already declares, and since nothing mutates `req.file`, your hooks always see the original upload. The sidecar arrives later as its own document create, which runs your collection hooks too — check `isVideoDerivative` if you need to tell them apart.

### Performance and cost

- Storage is source + one WebM per preset. The source is never sacrificed, so optimised versions can be regenerated at any time.
- VP9 is CPU-intensive. `ffmpeg.maxConcurrent` (default 2, per process) stops simultaneous uploads stampeding the encoder; for real volume, move the queue to a dedicated `payload jobs:run` container.
- `maxInputFileSize` keeps oversized masters out of the encoder entirely; `skipIfLarger` and `skipRedundantPresets` (both on) refuse work that wouldn't pay for itself.
- **Memory**: source videos are never held in memory — ffmpeg reads them from disk, and remote storage is streamed to a temp file. Each _stored_ rendition is read into a buffer once to hand to Payload's upload pipeline, so peak usage tracks output size, not input size. Temp directories are removed in `finally`, timeouts included.
- Encodes are only queued by writes that pass access control, and the regenerate endpoint refuses to stack a second conversion onto a document whose conversion is still in flight.
- Client-side uploads that bypass the Payload server (`upload.clientUploads`, presigned flows) never trigger the `afterChange` hook and are not converted.

### Scope

**WebM (VP9) is the only output today**, but the stored schema doesn't assume it: `renditions`, `isVideoDerivative` and `renditionPreset` name what they hold rather than the codec that filled them, so another format is a feature rather than a migration.

The one format worth adding is **AV1** — roughly 30% smaller than VP9 at the same quality, and royalty-free. It isn't here yet for three reasons worth knowing if you're weighing it up: it has to ship in MP4 rather than WebM (Safari plays AV1 in MP4 only), Safari needs hardware decode for it (A17 Pro / M3 and later), so VP9 stays alongside it rather than being replaced, and it requires exact `type='video/mp4; codecs="av01…"'` strings — with a bare `video/mp4` the browser claims it can play a stream it can't decode, giving a black video instead of a fallback. HEVC is a Safari-only, patent-encumbered cul-de-sac; VVC and AV2 have no meaningful browser deployment.

Keep the scale in mind either way: right-sizing already saves 4–40× here, and a format change is worth about 30% on top of that.

### Development and testing

The dev sandbox (`pnpm dev`) boots a Payload admin backed by SQLite with a `media` collection wired to a small width ladder and a portrait crop — upload an mp4/mov and watch the response return immediately while the sidebar panel fills in. A `pages` collection sits alongside it to demonstrate the `filterOptions` rule for upload fields.

Tests (`pnpm test`) generate their video fixtures with ffmpeg and run the full suite — `ffmpeg-static` is a devDependency, so no system install is needed. Set `FFMPEG_PATH` to run them against a distribution build instead. If the encode suite ever reports *skipped*, the binary didn't download: pnpm 10 blocks install scripts, so run `pnpm approve-builds` and pick `ffmpeg-static`.

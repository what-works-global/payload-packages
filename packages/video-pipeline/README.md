# @whatworks/payload-video-pipeline

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Video Pipeline" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Queue-based video transcoding for Payload — admin-editable breakpoint sizes, per-size staleness detection, and generated derivatives as real upload documents. Built entirely on Payload's own [Jobs Queue](https://payloadcms.com/docs/jobs-queue/overview) — no Redis, no BullMQ, nothing extra to run.

- **Video only.** There is no image-resizing pipeline here — Payload's own `imageSizes` already covers that.
- **Sizes double as responsive breakpoints.** Each configured output size carries a `breakpointMinWidth`, so the same admin-editable list drives both encode quality and which variant the frontend `<Video>` component serves at a given viewport.
- **Per-size staleness, not a version bump.** Editing one size in a five-size list only regenerates that one size — the rest stay untouched.
- **Derivatives are real upload documents**, created in a `video-derivatives` collection registered under your existing storage plugin (e.g. `@payloadcms/storage-s3`) — local-disk-in-dev / S3-in-prod happens automatically, the same way it already does for your `media` collection. No `upload()` callback, no env branching in plugin code.
- **Every derivative snapshots its own encode parameters** (resolution, bitrate, breakpoint, etc.) at generation time, so it stays meaningful even after the settings global changes or the size is deleted later.
- **Old derivatives are replaced, never left dangling.** A new derivative is only deleted from the previous run after its replacement is confirmed created — there's never a window where a document points at a missing file.
- **No poster frames.** Dropped entirely on purpose — this package only produces the video derivatives themselves.

## Installation

```sh
pnpm add @whatworks/payload-video-pipeline
```

Also install, in the **host project**:

```sh
pnpm add @vercel/functions
```

`payload-video-pipeline` uses `waitUntil` from `@vercel/functions` to run a queued transcode job to completion within the same serverless invocation that created it — this package targets Vercel serverless deployments.

## Usage

```ts
import { videoPipelinePlugin } from '@whatworks/payload-video-pipeline'
import { buildConfig } from 'payload'

export default buildConfig({
  collections: [
    // ...your `media` collection, already using an S3 storage adapter
  ],
  plugins: [
    videoPipelinePlugin({
      collections: ['media'],
      defaultVideoSizes: [
        {
          slug: '480p-webm',
          label: '480p',
          // No breakpointMinWidth — this is the fallback variant.
          audioBitrateKbps: 96,
          cpuUsed: 5,
          crf: 34,
          format: 'webm',
          resolutionHeight: 480,
        },
        {
          slug: '720p-webm',
          label: '720p',
          audioBitrateKbps: 96,
          breakpointMinWidth: 768,
          cpuUsed: 4,
          crf: 32,
          format: 'webm',
          resolutionHeight: 720,
        },
      ],
    }),
  ],
  // ...
})
```

Then register the generated `video-derivatives` collection under your existing storage plugin, right alongside `media`:

```ts
s3Storage({
  collections: {
    media: {
      /* ...existing config... */
    },
    'video-derivatives': {
      /* same bucket/prefix pattern as media */
    },
  },
  // ...
})
```

Skipping this step means `video-derivatives` falls back to local disk even in production — files vanish on the next deploy, since serverless platforms have no persistent disk.

### Frontend

```tsx
import { toVideoSources, Video } from '@whatworks/payload-video-pipeline/client'

export function MediaPlayer({ doc }: { doc: Media }) {
  return (
    <Video
      file={{
        url: doc.url,
        mimeType: doc.mimeType,
        videoDerivatives: toVideoSources(doc.videoDerivatives),
      }}
      controls
    />
  )
}
```

Query the media doc with enough `depth` (or an equivalent populate) that each `videoDerivatives[].derivative` relationship resolves to `{ url, mimeType }` rather than a bare id. `<Video>` picks the active source with `matchMedia` (not static `<source media="...">` tags, which only evaluate once at load) and preserves playback position across a source swap.

## How it works

- Uploading a video queues a `transcodeVideo` job and runs it immediately via `waitUntil`, so derivatives are usually ready by the time the upload request returns.
- The task diffs each configured size against the document's existing `videoDerivatives` entry for that slug — only sizes with no entry, an errored entry, or a changed field regenerate.
- A **Regenerate** button on each video document forces every existing size to re-run. A **Backfill** button on the settings global queues a `backfillVideoSizes` job per configured collection, which pages through existing documents and queues (still-diffed) transcodes for each.
- Removing a size from the settings global does **not** delete its existing derivatives — they're simply orphaned. Add a prune step yourself if this becomes a problem.

## Required manual project setup

- [ ] `CRON_SECRET` env var set in every deployment environment.
- [ ] A cron entry hitting `/api/payload-jobs/run` on a schedule (check your platform's minimum cron frequency).
- [ ] `video-derivatives` added to your storage plugin's `collections` config, matching `media`.
- [ ] Upload/regenerate routes given enough `maxDuration` for large files — `waitUntil` only extends the current invocation's own timeout, it doesn't grant unlimited time.
- [ ] `payload generate:types` run after installing the plugin.

## Development

```sh
pnpm --filter @whatworks/payload-video-pipeline dev
```

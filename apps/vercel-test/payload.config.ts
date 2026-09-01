import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { pushDevSchema } from '@payloadcms/drizzle'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildDevConfig, ensureDevUser } from '@whatworks/dev-fixture/dev-config'
import type { ConversionOutcome } from '@whatworks/payload-video-optimizer'
import { videoOptimizerPlugin, widthPresets } from '@whatworks/payload-video-optimizer'
import ffmpegStatic from 'ffmpeg-static'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Everything writable lives in /tmp, which on Vercel is per-instance and gone when
 * the instance is recycled. That is a deliberate trade, not an oversight: this app
 * exists to measure what one invocation can encode, and every request here does its
 * whole job inside a single invocation (see `dispatch: 'inline'`). Anything spanning
 * invocations — the /continue chain, a cron drain, the admin polling a document —
 * would land on an instance with a different database and a different disk, so those
 * are out of scope here and need shared storage to test.
 */
const runtimeDir = process.env.VERCEL
  ? '/tmp/video-optimizer-test'
  : path.resolve(dirname, '.local')
const mediaDir = path.join(runtimeDir, 'media')
fs.mkdirSync(mediaDir, { recursive: true })

const bucket = process.env.S3_BUCKET
const hasS3 = Boolean(bucket && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)

/**
 * Per-preset encode outcomes, keyed by document id, filled by `onConversionComplete`.
 *
 * The plugin stores a *total* encode duration on the document; the per-rung numbers
 * only exist in this callback. Module state is safe to read for the reason above —
 * the conversion runs inline, so the write and the read happen in one invocation.
 */
export const encodeOutcomes = new Map<string, ConversionOutcome[]>()

export default buildDevConfig({
  collections: [
    {
      slug: 'media',
      fields: [],
      upload: {
        mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
        staticDir: mediaDir,
      },
    },
  ],
  db: sqliteAdapter({
    client: { url: `file:${path.join(runtimeDir, 'test.db')}` },
    push: true,
  }),
  dirname,
  /**
   * The adapter only pushes its schema when NODE_ENV is not production, which on
   * Vercel it always is — so a cold start would meet an empty file and fail with
   * "no such table". Pushing by hand is the right answer specifically because the
   * database is disposable: it is recreated from the config on every cold start, so
   * there is no migration history worth keeping and no drift to reconcile.
   */
  onInit: async (payload) => {
    await pushDevSchema(payload.db as unknown as Parameters<typeof pushDevSchema>[0])
    await ensureDevUser(payload)
  },
  seedDevUser: false,
  plugins: [
    videoOptimizerPlugin({
      collections: ['media'],
      // Synchronous on purpose. Backgrounding the run would return a response before
      // there is anything to measure, and the follow-up request that checked on it
      // could land on a different instance with a different database.
      dispatch: 'inline',
      ffmpeg: { path: process.env.FFMPEG_PATH ?? ffmpegStatic ?? 'ffmpeg' },
      jobs: {
        // Below the function's maxDuration, which is what makes the ladder encode
        // cheapest-first and lets a rung too big for the platform be recorded as
        // `exceeds-budget` instead of killing the invocation mid-encode.
        maxRunMs: Number(process.env.VIDEO_MAX_RUN_MS ?? 700_000),
        // Nothing drains a queue here, so a retry would have nowhere to resume.
        retries: 0,
      },
      onConversionComplete: (outcome) => {
        const key = String(outcome.docId)
        encodeOutcomes.set(key, [...(encodeOutcomes.get(key) ?? []), outcome])
      },
      presets: widthPresets(
        process.env.VIDEO_WIDTHS
          ? process.env.VIDEO_WIDTHS.split(',').map((width) => Number(width))
          : undefined,
      ),
    }),
    // Only when configured, so `pnpm dev` still works off local disk with no
    // credentials. The video plugin needs nothing S3-aware: renditions are ordinary
    // upload documents in the same collection, so they inherit whatever adapter it
    // has — which is the whole point of the sidecar design.
    //
    // `clientUploads` is what makes a real video testable at all. Vercel caps request
    // bodies at a few megabytes, so a 21 MB source cannot reach the function; with
    // this the browser PUTs straight to the bucket and only the metadata comes here.
    ...(hasS3
      ? [
          s3Storage({
            bucket: bucket as string,
            clientUploads: true,
            // The bucket grants public read on public/* only, matching the other
            // buckets in this account.
            collections: { media: { prefix: 'public/media' } },
            config: {
              credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
              },
              region: process.env.S3_REGION ?? 'ap-southeast-2',
            },
          }),
        ]
      : []),
  ],
  // Deliberately no serverURL: the job reads the source through the collection's
  // storage adapter, in process. Needing one here would mean the function fetching
  // its own protected URL, which a preview deployment refuses.
  // Payload only auto-generates outside production, but an explicit false keeps a
  // preview deployment from spawning the detached generate:types worker.
  typescript: { autoGenerate: false },
})

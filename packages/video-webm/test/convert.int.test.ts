import type {
  CollectionBeforeChangeHook,
  CollectionBeforeOperationHook,
  JsonObject,
  Payload,
} from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConversionOutcome, DispatchJob } from '../src/index.js'

import { isFfmpegAvailable } from '../src/core/convert.js'
import { getVideoSources, getWebmUrl } from '../src/exports/frontend.js'
import { resolutionPresets, videoWebmPlugin } from '../src/index.js'

const execFileAsync = promisify(execFile)

const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg'
const ffmpegAvailable = await isFfmpegAvailable(ffmpegPath)

/** 1x1 transparent PNG — a real image so Payload's dimension probing succeeds. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

const isWebm = (buffer: Buffer): boolean => buffer.subarray(0, 4).equals(WEBM_MAGIC)

/** Local API depth may return relationship values as ids or populated docs. */
const relationId = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return null
}

const versionRows = (doc: JsonObject): { preset: string; video: unknown }[] =>
  Array.isArray(doc.webmVersions) ? (doc.webmVersions as { preset: string; video: unknown }[]) : []

/** Id of the first (most-preferred) rendition, or null while none exist. */
const firstSidecarId = (doc: JsonObject): null | number | string =>
  relationId(versionRows(doc)[0]?.video)

let payload: Payload
let tmpDir: string
/** Fat mp4 (high-bitrate mpeg4) — WebM output is reliably much smaller. */
let sampleMp4: Buffer
/** Same content in a QuickTime container. */
let sampleMov: Buffer
/** A genuine WebM file, for the bypass test. */
let sampleWebm: Buffer

const outcomes: ConversionOutcome[] = []
/** Every file each user hook saw, keyed by hook stage — sidecar creates included. */
const hookObservations: { beforeChange: string[]; beforeOperation: string[] } = {
  beforeChange: [],
  beforeOperation: [],
}
/** Dispatched-but-not-run conversions for the 'deferred' collection. */
const deferred: Array<{ job: DispatchJob; run: () => Promise<void> }> = []

const observeBeforeOperation: CollectionBeforeOperationHook = ({ req }) => {
  if (req.file) {
    hookObservations.beforeOperation.push(`${req.file.name}:${req.file.mimetype}`)
  }
}

const observeBeforeChange: CollectionBeforeChangeHook = ({ data, req }) => {
  if (req.file) {
    hookObservations.beforeChange.push(`${req.file.name}:${req.file.mimetype}`)
  }
  return data
}

const upload = (
  collection: string,
  file: { data: Buffer; mimetype: string; name: string },
  data: Record<string, unknown> = {},
) =>
  payload.create({
    collection,
    data,
    file: { ...file, size: file.data.byteLength },
  })

const fetchDoc = (collection: string, id: number | string): Promise<JsonObject> =>
  payload.findByID({ id, collection, depth: 0 }) as Promise<JsonObject>

const generateFixture = async (name: string, args: string[]): Promise<Buffer> => {
  const filePath = path.join(tmpDir, name)
  await execFileAsync(ffmpegPath, ['-y', ...args, filePath])
  return fs.readFileSync(filePath)
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-video-webm-test-'))

  // Stand-in "ffmpeg" that writes 1MiB of zeros to the output path (the final
  // argument) — a deterministic always-larger result for the skipIfLarger tests,
  // with no encoder variance and no ffmpeg requirement. Writes only for encode
  // invocations (*.webm output) so the boot-time `-encoders` probe stays inert.
  const inflatingBinary = path.join(tmpDir, 'inflating-ffmpeg')
  fs.writeFileSync(
    inflatingBinary,
    '#!/bin/sh\nfor arg do out="$arg"; done\ncase "$out" in *.webm) head -c 1048576 /dev/zero > "$out";; esac\n',
    { mode: 0o755 },
  )

  if (ffmpegAvailable) {
    // Fixtures are generated instead of committed — mpeg4 (unlike libx264) is
    // compiled into every ffmpeg build. -q:v 1 makes the mp4/mov sources fat enough
    // that the WebM output is reliably smaller, keeping the skipIfLarger default inert.
    const testsrc = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=30']
    const sine = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2']
    sampleMp4 = await generateFixture('sample.mp4', [
      ...testsrc,
      ...sine,
      ...['-c:v', 'mpeg4', '-q:v', '1', '-c:a', 'aac', '-shortest'],
    ])
    sampleMov = await generateFixture('sample.mov', [
      ...testsrc,
      ...sine,
      ...['-c:v', 'mpeg4', '-q:v', '1', '-c:a', 'aac', '-shortest'],
    ])
    sampleWebm = await generateFixture('sample.webm', [
      ...['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15'],
      ...['-c:v', 'libvpx-vp9', '-crf', '50', '-b:v', '0', '-cpu-used', '5'],
    ])
  }

  const uploadCollection = (slug: string) => ({
    slug,
    fields: [],
    upload: { staticDir: path.join(tmpDir, slug) },
  })

  const config = await buildConfig({
    collections: [
      {
        slug: 'media',
        fields: [{ name: 'alt', type: 'text' }],
        upload: {
          mimeTypes: ['video/mp4', 'video/quicktime', 'image/*'],
          staticDir: path.join(tmpDir, 'media'),
        },
      },
      {
        ...uploadCollection('hooked'),
        hooks: {
          beforeChange: [observeBeforeChange],
          beforeOperation: [observeBeforeOperation],
        },
      },
      // The required field exercises the data copy onto sidecar documents.
      {
        ...uploadCollection('archive'),
        fields: [{ name: 'caption', type: 'text', required: true }],
      },
      uploadCollection('capped'),
      uploadCollection('ladder'),
      uploadCollection('vp8-media'),
      uploadCollection('filtered'),
      uploadCollection('deferred'),
      uploadCollection('guarded'),
      uploadCollection('failing'),
    ],
    db: sqliteAdapter({
      client: { url: `file:${path.join(tmpDir, 'test.db')}` },
      push: true,
    }),
    plugins: [
      // Default (no dispatch): the job runs inline, so payload.create resolves
      // only after the conversion finished — convenient for these tests.
      videoWebmPlugin({
        collections: {
          archive: true,
          capped: { maxInputFileSize: 16 },
          filtered: { shouldConvert: ({ file }) => !file.name.includes('skipme') },
          hooked: true,
          // Two renditions from the ready-made quality ladder (tiny ones for speed).
          ladder: { presets: resolutionPresets([144, 240]) },
          media: true,
          'vp8-media': { encoding: { codec: 'vp8', crf: 50, speed: 16 } },
        },
        // Cheapest settings that still exercise the real pipeline.
        encoding: { crf: 50, speed: 5 },
        maxConcurrentEncodes: 2,
        onConversionComplete: (outcome) => {
          outcomes.push(outcome)
        },
      }),
      // Captures the dispatch instead of running it — proves the upload response
      // does not wait for the encode.
      videoWebmPlugin({
        collections: ['deferred'],
        dispatch: (job, { run }) => {
          deferred.push({ job, run })
        },
        encoding: { crf: 50, speed: 5 },
        taskSlug: 'video-webm-convert-deferred',
      }),
      // The inflating stand-in makes every "conversion" larger than its input,
      // deterministically exercising the skipIfLarger guard.
      videoWebmPlugin({
        collections: ['guarded'],
        ffmpegPath: inflatingBinary,
        onConversionComplete: (outcome) => {
          outcomes.push(outcome)
        },
        taskSlug: 'video-webm-convert-guarded',
      }),
      // Broken ffmpeg — the job must fail, record the error, and leave the original.
      videoWebmPlugin({
        collections: ['failing'],
        ffmpegPath: path.join(tmpDir, 'missing-ffmpeg'),
        taskSlug: 'video-webm-convert-failing',
      }),
    ],
    secret: 'test-secret',
    // Prevents Payload spawning a detached generate:types worker per boot.
    typescript: { autoGenerate: false },
  })

  payload = await getPayload({ config })
})

afterAll(async () => {
  if (typeof payload?.db?.destroy === 'function') {
    await payload.db.destroy()
  }
  fs.rmSync(tmpDir, { force: true, recursive: true })
})

describe.skipIf(!ffmpegAvailable)('async conversion (requires ffmpeg)', () => {
  it('responds with a queued record, then the job stores a WebM sidecar next to the intact original', async () => {
    const created = await upload(
      'media',
      { name: 'clip.mp4', data: sampleMp4, mimetype: 'video/mp4' },
      { alt: 'test clip' },
    )

    // The upload response itself only reflects the queued state — conversion is a job.
    expect(created.mimeType).toBe('video/mp4')
    expect((created as JsonObject).videoWebm).toMatchObject({ status: 'queued' })
    expect(versionRows(created as JsonObject)).toHaveLength(0)

    // Default dispatch ran the job inline, so it is already done — re-fetch.
    const doc = await fetchDoc('media', created.id as number)
    expect(doc.mimeType).toBe('video/mp4')
    expect(doc.filename).toBe('clip.mp4')
    expect(fs.readFileSync(path.join(tmpDir, 'media', 'clip.mp4')).equals(sampleMp4)).toBe(true)
    expect(doc.videoWebm).toMatchObject({
      originalFilename: 'clip.mp4',
      originalFilesize: sampleMp4.byteLength,
      originalMimeType: 'video/mp4',
      status: 'complete',
    })
    expect((doc.videoWebm as JsonObject).encodeDurationMs).toBeGreaterThan(0)

    const rows = versionRows(doc)
    expect(rows).toHaveLength(1)
    expect(rows[0].preset).toBe('webm')
    const sidecar = await fetchDoc('media', firstSidecarId(doc)!)
    expect(sidecar.mimeType).toBe('video/webm')
    expect(sidecar.isWebmDerivative).toBe(true)
    expect(sidecar.webmPreset).toBe('webm')
    expect(isWebm(fs.readFileSync(path.join(tmpDir, 'media', String(sidecar.filename))))).toBe(true)
    expect(sidecar.filesize).toBeLessThan(sampleMp4.byteLength)

    expect(outcomes.find((o) => o.originalFilename === 'clip.mp4')).toMatchObject({
      collection: 'media',
      converted: true,
      convertedFilename: 'clip.webm',
      preset: 'webm',
      skippedReason: null,
    })
  })

  it('does not run the encode until the host dispatch does', async () => {
    const created = await upload('deferred', {
      name: 'later.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })

    // Nothing ran yet: still queued, no sidecar — the response never waited.
    let doc = await fetchDoc('deferred', created.id as number)
    expect(doc.videoWebm).toMatchObject({ status: 'queued' })
    expect(versionRows(doc)).toHaveLength(0)
    expect(deferred).toHaveLength(1)
    expect(deferred[0].job).toMatchObject({ collection: 'deferred', sourceFilename: 'later.mp4' })

    await deferred[0].run()

    doc = await fetchDoc('deferred', created.id as number)
    expect(doc.videoWebm).toMatchObject({ status: 'complete' })
    expect(firstSidecarId(doc)).not.toBeNull()
  })

  it('converts QuickTime sources and VP8 targets', async () => {
    const mov = await upload('media', {
      name: 'movie.mov',
      data: sampleMov,
      mimetype: 'video/quicktime',
    })
    const movDoc = await fetchDoc('media', mov.id as number)
    expect(movDoc.videoWebm).toMatchObject({ status: 'complete' })

    const vp8 = await upload('vp8-media', {
      name: 'clip-vp8.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    const vp8Doc = await fetchDoc('vp8-media', vp8.id as number)
    const sidecar = await fetchDoc('vp8-media', firstSidecarId(vp8Doc)!)
    expect(isWebm(fs.readFileSync(path.join(tmpDir, 'vp8-media', String(sidecar.filename))))).toBe(
      true,
    )
  })

  it('generates one rendition per preset and serves them via the frontend helpers', async () => {
    const created = await upload('ladder', {
      name: 'steps.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })

    const doc = await fetchDoc('ladder', created.id as number)
    expect(doc.videoWebm).toMatchObject({ status: 'complete' })
    const rows = versionRows(doc)
    // Declaration order preserved — first preset is the preferred rendition.
    expect(rows.map((row) => row.preset)).toEqual(['144p', '240p'])

    const sidecars = await Promise.all(
      rows.map((row) => fetchDoc('ladder', relationId(row.video)!)),
    )
    expect(sidecars.map((s) => s.filename)).toEqual(['steps-144p.webm', 'steps-240p.webm'])
    for (const sidecar of sidecars) {
      expect(isWebm(fs.readFileSync(path.join(tmpDir, 'ladder', String(sidecar.filename))))).toBe(
        true,
      )
    }

    // Frontend helpers, on a depth-populated doc.
    const populated = (await payload.findByID({
      id: created.id,
      collection: 'ladder',
      depth: 1,
    })) as JsonObject
    const sources = getVideoSources(populated)
    expect(sources.map((s) => s.preset)).toEqual(['144p', '240p', null])
    expect(sources.at(-1)).toMatchObject({ type: 'video/mp4', src: doc.url })
    expect(getWebmUrl(populated)).toBe(sources[0].src)
    expect(getWebmUrl(populated, '240p')).toBe(sources[1].src)
    expect(getWebmUrl(populated, 'nope')).toBeNull()
    // Unpopulated (depth 0) rows degrade to the original-only fallback.
    expect(getVideoSources(doc).map((s) => s.preset)).toEqual([null])
  })

  it('copies user fields onto the sidecar so required fields validate', async () => {
    const created = await upload(
      'archive',
      { name: 'master.mp4', data: sampleMp4, mimetype: 'video/mp4' },
      { caption: 'the master file' },
    )
    const doc = await fetchDoc('archive', created.id as number)
    const sidecar = await fetchDoc('archive', firstSidecarId(doc)!)
    expect(sidecar.caption).toBe('the master file')
  })

  it('regenerates the sidecar when the file is replaced, and clears it for non-videos', async () => {
    const created = await upload('media', {
      name: 'replace-me.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    const first = firstSidecarId(await fetchDoc('media', created.id as number))
    expect(first).not.toBeNull()

    await payload.update({
      id: created.id,
      collection: 'media',
      data: {},
      file: {
        name: 'v2.mov',
        data: sampleMov,
        mimetype: 'video/quicktime',
        size: sampleMov.byteLength,
      },
    })
    // Ids can be reused by sqlite after a delete, so assert by content: the doc
    // now links a sidecar for the NEW file, and only one sidecar exists for it.
    const second = firstSidecarId(await fetchDoc('media', created.id as number))
    expect(second).not.toBeNull()
    const secondSidecar = await fetchDoc('media', second!)
    expect(secondSidecar.filename).toBe('v2.webm')
    const sidecars = await payload.find({
      collection: 'media',
      depth: 0,
      where: { filename: { contains: 'v2' }, isWebmDerivative: { equals: true } },
    })
    expect(sidecars.totalDocs).toBe(1)

    // Replacing with a non-video clears the link and removes the last sidecar.
    await payload.update({
      id: created.id,
      collection: 'media',
      data: {},
      file: { name: 'pic.png', data: PNG_1X1, mimetype: 'image/png', size: PNG_1X1.byteLength },
    })
    const cleared = await fetchDoc('media', created.id as number)
    expect(versionRows(cleared)).toHaveLength(0)
    expect((cleared.videoWebm as JsonObject).status).toBeNull()
    await expect(fetchDoc('media', second!)).rejects.toThrow()
  })

  it('deletes the sidecar with the original', async () => {
    const created = await upload('media', {
      name: 'doomed.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    const sidecarId = firstSidecarId(await fetchDoc('media', created.id as number))
    expect(sidecarId).not.toBeNull()

    await payload.delete({ id: created.id, collection: 'media' })
    await expect(fetchDoc('media', sidecarId!)).rejects.toThrow()
  })

  it('preserves conversion metadata when a document is re-saved without a new file', async () => {
    const created = await upload('media', {
      name: 'resave.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    const resaved = await payload.update({
      id: created.id,
      collection: 'media',
      data: { alt: 'edited alt text only' },
    })
    expect((resaved as JsonObject).videoWebm).toMatchObject({
      originalFilename: 'resave.mp4',
      status: 'complete',
    })
    expect(firstSidecarId(resaved as JsonObject)).not.toBeNull()
  })

  it('is idempotent: a duplicate job run leaves the existing sidecar alone', async () => {
    const created = await upload('media', {
      name: 'twice.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    const before = await payload.count({ collection: 'media' })

    // Simulate the cron safety net colliding with the already-finished run.
    const job = (await payload.jobs.queue({
      input: { collection: 'media', docId: created.id, sourceFilename: 'twice.mp4' },
      queue: 'video-webm',
      task: 'video-webm-convert',
    } as never)) as { id: number | string }
    await payload.jobs.runByID({ id: job.id })

    const after = await payload.count({ collection: 'media' })
    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it('never touches req.file — existing hooks always see the original upload', async () => {
    await upload('hooked', { name: 'ordered.mp4', data: sampleMp4, mimetype: 'video/mp4' })
    // The user's hooks saw the untouched original…
    expect(hookObservations.beforeOperation).toContain('ordered.mp4:video/mp4')
    expect(hookObservations.beforeChange).toContain('ordered.mp4:video/mp4')
    // …and the sidecar arrived as its own separate document create.
    expect(hookObservations.beforeChange).toContain('ordered.webm:video/webm')
  })

  it('bypasses WebM uploads untouched, reporting already-webm', async () => {
    const doc = await upload('media', {
      name: 'native.webm',
      data: sampleWebm,
      mimetype: 'video/webm',
    })
    expect(doc.mimeType).toBe('video/webm')
    expect(doc.filename).toBe('native.webm')
    expect((doc as JsonObject).videoWebm).toMatchObject({ status: null })
    expect(outcomes.find((o) => o.originalFilename === 'native.webm')).toMatchObject({
      converted: false,
      skippedReason: 'already-webm',
    })
  })

  it('leaves image uploads untouched and unreported', async () => {
    const doc = await upload('media', { name: 'plain.png', data: PNG_1X1, mimetype: 'image/png' })
    expect(doc.mimeType).toBe('image/png')
    expect((doc as JsonObject).videoWebm).toMatchObject({ status: null })
    expect(outcomes.some((o) => o.originalFilename === 'plain.png')).toBe(false)
  })

  it('records input-too-large at upload time without queueing a job', async () => {
    const doc = await upload('capped', { name: 'big.mp4', data: sampleMp4, mimetype: 'video/mp4' })
    expect((doc as JsonObject).videoWebm).toMatchObject({
      skippedReason: 'input-too-large',
      status: 'skipped',
    })
    // Still skipped after create returned — nothing ran later to change it.
    const refetched = await fetchDoc('capped', doc.id as number)
    expect(versionRows(refetched)).toHaveLength(0)
    expect(outcomes.find((o) => o.originalFilename === 'big.mp4')).toMatchObject({
      skippedReason: 'input-too-large',
    })
  })

  it('lets the shouldConvert predicate veto conversions, reported but not stamped', async () => {
    const vetoed = await upload('filtered', {
      name: 'skipme.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect((vetoed as JsonObject).videoWebm).toMatchObject({ skippedReason: null, status: null })
    expect(outcomes.find((o) => o.originalFilename === 'skipme.mp4')).toMatchObject({
      skippedReason: 'filtered',
    })

    const converted = await upload('filtered', {
      name: 'keepme.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    const doc = await fetchDoc('filtered', converted.id as number)
    expect(doc.videoWebm).toMatchObject({ status: 'complete' })
  })
})

describe.skipIf(process.platform === 'win32')('deterministic paths (no ffmpeg needed)', () => {
  it('records output-larger and keeps the intact original, without a sidecar', async () => {
    const source = { name: 'tiny.mp4', data: Buffer.from('a perfectly small mp4') }
    const created = await upload('guarded', { ...source, mimetype: 'video/mp4' })

    const doc = await fetchDoc('guarded', created.id as number)
    expect(doc.mimeType).toBe('video/mp4')
    expect(doc.filesize).toBe(source.data.byteLength)
    expect(doc.videoWebm).toMatchObject({ skippedReason: 'output-larger', status: 'skipped' })
    expect(versionRows(doc)).toHaveLength(0)
    // Byte-identical original — the discarded WebM never touched it.
    expect(fs.readFileSync(path.join(tmpDir, 'guarded', 'tiny.mp4')).equals(source.data)).toBe(true)

    const { totalDocs } = await payload.count({ collection: 'guarded' })
    expect(totalDocs).toBe(1)

    expect(outcomes.find((o) => o.originalFilename === 'tiny.mp4')).toMatchObject({
      collection: 'guarded',
      converted: false,
      skippedReason: 'output-larger',
    })
  })

  it('records a failed job on the document and keeps the original stored', async () => {
    const source = { name: 'broken.mp4', data: Buffer.from('not really a video') }
    const created = await upload('failing', { ...source, mimetype: 'video/mp4' })

    // The upload itself succeeded regardless of the failing conversion.
    expect(created.mimeType).toBe('video/mp4')
    expect(fs.readFileSync(path.join(tmpDir, 'failing', 'broken.mp4')).equals(source.data)).toBe(
      true,
    )

    const doc = await fetchDoc('failing', created.id as number)
    expect(doc.videoWebm).toMatchObject({ status: 'failed' })
    expect(String((doc.videoWebm as JsonObject).error)).toMatch(/ffmpeg/)
    expect(versionRows(doc)).toHaveLength(0)
  })
})

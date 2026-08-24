import type { CollectionBeforeChangeHook, CollectionBeforeOperationHook, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConversionOutcome } from '../src/index.js'

import { isFfmpegAvailable } from '../src/core/convert.js'
import { videoWebmPlugin } from '../src/index.js'

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

/** Local API depth may return webmVersion as an id or a populated doc. */
const relationId = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return null
}

let payload: Payload
let tmpDir: string
/** Fat mp4 (high-bitrate mpeg4) — WebM output is reliably much smaller. */
let sampleMp4: Buffer
/** Same content in a QuickTime container. */
let sampleMov: Buffer
/** A genuine WebM file, for the bypass test. */
let sampleWebm: Buffer

const outcomes: ConversionOutcome[] = []
const hookObservations: { beforeChange?: string; beforeOperation?: string } = {}

const observeBeforeOperation: CollectionBeforeOperationHook = ({ req }) => {
  if (req.file) {
    hookObservations.beforeOperation = req.file.mimetype
  }
}

const observeBeforeChange: CollectionBeforeChangeHook = ({ data, req }) => {
  if (req.file) {
    hookObservations.beforeChange = req.file.mimetype
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
      {
        // keepOriginal mode; the required field exercises the data copy onto sidecars.
        ...uploadCollection('archive'),
        fields: [{ name: 'caption', type: 'text', required: true }],
      },
      uploadCollection('guarded'),
      uploadCollection('guarded-keep'),
      uploadCollection('capped'),
      uploadCollection('vp8-media'),
      uploadCollection('filtered'),
      // Broken ffmpeg + onError: 'skip' — uploads must survive unconverted.
      uploadCollection('resilient'),
      // Broken ffmpeg + default onError: 'throw' — uploads must fail loudly.
      uploadCollection('strict'),
    ],
    db: sqliteAdapter({
      client: { url: `file:${path.join(tmpDir, 'test.db')}` },
      push: true,
    }),
    plugins: [
      videoWebmPlugin({
        collections: {
          archive: { keepOriginal: true },
          capped: { maxInputFileSize: 16 },
          filtered: { shouldConvert: ({ file }) => !file.name.includes('skipme') },
          hooked: true,
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
      // The inflating stand-in makes every "conversion" larger than its input,
      // deterministically exercising the skipIfLarger guard in both modes.
      videoWebmPlugin({
        collections: { guarded: true, 'guarded-keep': { keepOriginal: true } },
        ffmpegPath: inflatingBinary,
        onConversionComplete: (outcome) => {
          outcomes.push(outcome)
        },
      }),
      videoWebmPlugin({
        collections: ['resilient'],
        ffmpegPath: path.join(tmpDir, 'missing-ffmpeg'),
        onError: 'skip',
      }),
      videoWebmPlugin({
        collections: ['strict'],
        ffmpegPath: path.join(tmpDir, 'missing-ffmpeg'),
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

describe.skipIf(!ffmpegAvailable)('conversion (requires ffmpeg)', () => {
  it('stores an mp4 upload as WebM with consistent filename, mimeType and filesize', async () => {
    const doc = await upload(
      'media',
      { name: 'clip.mp4', data: sampleMp4, mimetype: 'video/mp4' },
      { alt: 'test clip' },
    )

    expect(doc.mimeType).toBe('video/webm')
    expect(doc.filename).toBe('clip.webm')

    const stored = fs.readFileSync(path.join(tmpDir, 'media', String(doc.filename)))
    expect(isWebm(stored)).toBe(true)
    expect(doc.filesize).toBe(stored.byteLength)

    expect(doc.videoWebm).toMatchObject({
      converted: true,
      originalFilename: 'clip.mp4',
      originalFilesize: sampleMp4.byteLength,
      originalMimeType: 'video/mp4',
      skippedReason: null,
    })
    expect(doc.videoWebm.encodeDurationMs).toBeGreaterThan(0)

    const outcome = outcomes.find((o) => o.originalFilename === 'clip.mp4')
    expect(outcome).toMatchObject({
      collection: 'media',
      converted: true,
      convertedFilename: 'clip.webm',
      convertedFilesize: stored.byteLength,
      originalFilesize: sampleMp4.byteLength,
      skippedReason: null,
    })
    expect(outcome?.encodeDurationMs).toBeGreaterThan(0)
  })

  it('preserves conversion metadata when a document is re-saved without a new file', async () => {
    const created = await upload('media', {
      name: 'resave.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect(created.videoWebm).toMatchObject({ converted: true, originalFilename: 'resave.mp4' })

    const resaved = await payload.update({
      id: created.id,
      collection: 'media',
      data: { alt: 'edited alt text only' },
    })
    expect(resaved.videoWebm).toMatchObject({
      converted: true,
      originalFilename: 'resave.mp4',
      originalFilesize: sampleMp4.byteLength,
    })
  })

  it('converts a QuickTime .mov upload', async () => {
    const doc = await upload('media', {
      name: 'movie.mov',
      data: sampleMov,
      mimetype: 'video/quicktime',
    })
    expect(doc.mimeType).toBe('video/webm')
    expect(doc.filename).toBe('movie.webm')
    expect(isWebm(fs.readFileSync(path.join(tmpDir, 'media', String(doc.filename))))).toBe(true)
  })

  it('converts with VP8 when configured', async () => {
    const doc = await upload('vp8-media', {
      name: 'clip-vp8.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect(doc.mimeType).toBe('video/webm')
    expect(isWebm(fs.readFileSync(path.join(tmpDir, 'vp8-media', String(doc.filename))))).toBe(true)
  })

  it('converts a replacement file on update', async () => {
    const created = await upload('media', {
      name: 'pixel.png',
      data: PNG_1X1,
      mimetype: 'image/png',
    })
    expect(created.mimeType).toBe('image/png')
    expect(created.videoWebm).toMatchObject({ converted: false })

    const updated = await payload.update({
      id: created.id,
      collection: 'media',
      data: {},
      file: {
        name: 'replacement.mp4',
        data: sampleMp4,
        mimetype: 'video/mp4',
        size: sampleMp4.byteLength,
      },
    })

    expect(updated.mimeType).toBe('video/webm')
    expect(updated.filename).toBe('replacement.webm')
    expect(updated.videoWebm).toMatchObject({ converted: true })
  })

  it('keeps unicode and uppercase filenames coherent after conversion', async () => {
    const doc = await upload('media', {
      name: 'Видео-Holiday.MP4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect(doc.mimeType).toBe('video/webm')
    expect(String(doc.filename).endsWith('.webm')).toBe(true)
    expect(String(doc.filename).endsWith('.MP4')).toBe(false)
    const stored = fs.readFileSync(path.join(tmpDir, 'media', String(doc.filename)))
    expect(isWebm(stored)).toBe(true)
    expect(doc.filesize).toBe(stored.byteLength)
  })

  it('bypasses WebM uploads untouched, reporting already-webm', async () => {
    const doc = await upload('media', {
      name: 'native.webm',
      data: sampleWebm,
      mimetype: 'video/webm',
    })
    expect(doc.mimeType).toBe('video/webm')
    expect(doc.filename).toBe('native.webm')
    expect(doc.filesize).toBe(sampleWebm.byteLength)
    expect(doc.videoWebm).toMatchObject({ converted: false, skippedReason: null })

    expect(outcomes.find((o) => o.originalFilename === 'native.webm')).toMatchObject({
      converted: false,
      skippedReason: 'already-webm',
    })
  })

  it('leaves image uploads untouched and unreported', async () => {
    const doc = await upload('media', {
      name: 'plain.png',
      data: PNG_1X1,
      mimetype: 'image/png',
    })
    expect(doc.mimeType).toBe('image/png')
    expect(doc.filename).toBe('plain.png')
    expect(outcomes.some((o) => o.originalFilename === 'plain.png')).toBe(false)
  })

  it('skips files above maxInputFileSize and records the reason', async () => {
    const doc = await upload('capped', {
      name: 'big.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect(doc.mimeType).toBe('video/mp4')
    expect(doc.videoWebm).toMatchObject({ converted: false, skippedReason: 'input-too-large' })
    expect(outcomes.find((o) => o.originalFilename === 'big.mp4')).toMatchObject({
      skippedReason: 'input-too-large',
    })
  })

  it('lets the shouldConvert predicate veto conversions, reported but not stamped', async () => {
    const doc = await upload('filtered', {
      name: 'skipme.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect(doc.mimeType).toBe('video/mp4')
    // Vetoes are intentional, so the metadata group records no anomaly…
    expect(doc.videoWebm).toMatchObject({ converted: false, skippedReason: null })
    // …but observability still sees the decision.
    expect(outcomes.find((o) => o.originalFilename === 'skipme.mp4')).toMatchObject({
      collection: 'filtered',
      converted: false,
      skippedReason: 'filtered',
    })

    const converted = await upload('filtered', {
      name: 'keepme.mp4',
      data: sampleMp4,
      mimetype: 'video/mp4',
    })
    expect(converted.mimeType).toBe('video/webm')
  })

  it('keepOriginal: stores the untouched original and links a WebM sidecar document', async () => {
    const doc = await upload(
      'archive',
      { name: 'master.mp4', data: sampleMp4, mimetype: 'video/mp4' },
      { caption: 'the master file' },
    )

    // The document's own file is the pristine original.
    expect(doc.mimeType).toBe('video/mp4')
    expect(doc.filename).toBe('master.mp4')
    expect(fs.readFileSync(path.join(tmpDir, 'archive', 'master.mp4')).equals(sampleMp4)).toBe(true)
    // originalFilesize regression: req.file.size is gone by beforeChange, so the
    // sidecar path must derive it from the buffer.
    expect(doc.videoWebm).toMatchObject({
      converted: true,
      originalFilename: 'master.mp4',
      originalFilesize: sampleMp4.byteLength,
    })

    // The sidecar lives in the same collection, hidden-flagged, with copied data.
    const sidecarId = relationId(doc.webmVersion)
    expect(sidecarId).not.toBeNull()
    const sidecar = await payload.findByID({ id: sidecarId!, collection: 'archive' })
    expect(sidecar.mimeType).toBe('video/webm')
    expect(sidecar.isWebmDerivative).toBe(true)
    expect(sidecar.caption).toBe('the master file')
    expect(isWebm(fs.readFileSync(path.join(tmpDir, 'archive', String(sidecar.filename))))).toBe(
      true,
    )

    expect(outcomes.find((o) => o.originalFilename === 'master.mp4')).toMatchObject({
      collection: 'archive',
      converted: true,
    })
  })

  it('keepOriginal: replacing the file regenerates the sidecar and deletes the stale one', async () => {
    const created = await upload(
      'archive',
      { name: 'replace-me.mp4', data: sampleMp4, mimetype: 'video/mp4' },
      { caption: 'v1' },
    )
    const firstSidecarId = relationId(created.webmVersion)
    expect(firstSidecarId).not.toBeNull()

    const updated = await payload.update({
      id: created.id,
      collection: 'archive',
      data: {},
      file: {
        name: 'v2.mov',
        data: sampleMov,
        mimetype: 'video/quicktime',
        size: sampleMov.byteLength,
      },
    })
    const secondSidecarId = relationId(updated.webmVersion)
    expect(secondSidecarId).not.toBeNull()
    expect(secondSidecarId).not.toBe(firstSidecarId)
    await expect(payload.findByID({ id: firstSidecarId!, collection: 'archive' })).rejects.toThrow()

    // Replacing with a non-video clears the link and removes the last sidecar.
    const cleared = await payload.update({
      id: created.id,
      collection: 'archive',
      data: {},
      file: { name: 'pic.png', data: PNG_1X1, mimetype: 'image/png', size: PNG_1X1.byteLength },
    })
    expect(relationId(cleared.webmVersion)).toBeNull()
    await expect(
      payload.findByID({ id: secondSidecarId!, collection: 'archive' }),
    ).rejects.toThrow()
  })

  it('keepOriginal: deleting the original deletes its sidecar', async () => {
    const doc = await upload(
      'archive',
      { name: 'doomed.mp4', data: sampleMp4, mimetype: 'video/mp4' },
      { caption: 'delete me' },
    )
    const sidecarId = relationId(doc.webmVersion)
    expect(sidecarId).not.toBeNull()

    await payload.delete({ id: doc.id, collection: 'archive' })
    await expect(payload.findByID({ id: sidecarId!, collection: 'archive' })).rejects.toThrow()
  })

  it('runs after existing beforeOperation hooks and before beforeChange hooks', async () => {
    await upload('hooked', { name: 'ordered.mp4', data: sampleMp4, mimetype: 'video/mp4' })
    // The collection's own beforeOperation hook saw the original upload…
    expect(hookObservations.beforeOperation).toBe('video/mp4')
    // …while its beforeChange hook already saw the converted file.
    expect(hookObservations.beforeChange).toBe('video/webm')
  })
})

describe.skipIf(process.platform === 'win32')('skipIfLarger (no ffmpeg needed)', () => {
  it('keeps the intact original when the WebM output would be larger', async () => {
    const source = { name: 'tiny.mp4', data: Buffer.from('a perfectly small mp4') }
    const doc = await upload('guarded', { ...source, mimetype: 'video/mp4' })

    expect(doc.mimeType).toBe('video/mp4')
    expect(doc.filename).toBe('tiny.mp4')
    expect(doc.filesize).toBe(source.data.byteLength)
    expect(doc.videoWebm).toMatchObject({ converted: false, skippedReason: 'output-larger' })

    // Byte-identical original — the discarded WebM never touched it.
    expect(fs.readFileSync(path.join(tmpDir, 'guarded', 'tiny.mp4')).equals(source.data)).toBe(true)

    expect(outcomes.find((o) => o.originalFilename === 'tiny.mp4')).toMatchObject({
      collection: 'guarded',
      converted: false,
      convertedFilename: null,
      skippedReason: 'output-larger',
    })
  })

  it('keepOriginal: records output-larger without creating a sidecar', async () => {
    const source = { name: 'tiny-keep.mp4', data: Buffer.from('an efficient little mp4') }
    const doc = await upload('guarded-keep', { ...source, mimetype: 'video/mp4' })

    expect(doc.mimeType).toBe('video/mp4')
    expect(relationId(doc.webmVersion)).toBeNull()
    expect(doc.videoWebm).toMatchObject({ converted: false, skippedReason: 'output-larger' })

    const { totalDocs } = await payload.count({ collection: 'guarded-keep' })
    expect(totalDocs).toBe(1)
  })
})

describe('failure handling (no ffmpeg needed)', () => {
  const fakeMp4 = {
    name: 'broken.mp4',
    data: Buffer.from('not really a video'),
    mimetype: 'video/mp4',
  }

  it("onError: 'skip' stores the original untouched and records the failure", async () => {
    const doc = await upload('resilient', fakeMp4)
    expect(doc.mimeType).toBe('video/mp4')
    expect(doc.filename).toBe('broken.mp4')
    expect(doc.filesize).toBe(fakeMp4.data.byteLength)
    expect(doc.videoWebm).toMatchObject({ converted: false, skippedReason: 'ffmpeg-failed' })
    expect(fs.readFileSync(path.join(tmpDir, 'resilient', 'broken.mp4')).equals(fakeMp4.data)).toBe(
      true,
    )
  })

  it("default onError: 'throw' rejects the upload with the underlying ffmpeg error", async () => {
    await expect(upload('strict', fakeMp4)).rejects.toThrow(
      /payload-video-webm.*broken\.mp4.*could not spawn ffmpeg/s,
    )
  })
})

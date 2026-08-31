/**
 * Guards the `populate` recipe in the README.
 *
 * `populate` is a strict allowlist keyed by collection slug, so omitting
 * `renditions` returns a video with no renditions attached and every helper
 * silently falls back to the original file — the optimisation doing nothing, with
 * no error anywhere. That failure is invisible enough to be worth a test, even
 * though the behaviour under test is Payload's rather than the plugin's.
 */
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getVideoSourceSet } from '../src/exports/frontend.js'
import { EXCLUDE_VIDEO_DERIVATIVES, videoOptimizerPlugin } from '../src/index.js'

/** 1x1 transparent PNG. The recipe is about relationships, not about encoding. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-optimizer-populate-'))
let payload: Awaited<ReturnType<typeof getPayload>>
let pageId: number | string

beforeAll(async () => {
  const config = await buildConfig({
    collections: [
      {
        slug: 'media',
        fields: [{ name: 'alt', type: 'text' }],
        upload: { mimeTypes: ['image/*'], staticDir: path.join(tmpDir, 'media') },
      },
      {
        slug: 'pages',
        fields: [
          {
            name: 'hero',
            type: 'upload',
            filterOptions: EXCLUDE_VIDEO_DERIVATIVES,
            relationTo: 'media',
          },
        ],
      },
    ],
    db: sqliteAdapter({ client: { url: `file:${path.join(tmpDir, 'db.sqlite')}` }, push: true }),
    plugins: [videoOptimizerPlugin({ collections: ['media'], dispatch: 'inline' })],
    secret: 'test-secret',
    // Without one, Payload returns `url: null` on uploads and there is nothing for
    // the helpers to build a <source> from.
    serverURL: 'http://localhost:3000',
    // Stops Payload spawning a detached generate:types worker per boot.
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config })

  const file = { name: 'clip.png', data: PNG, mimetype: 'image/png', size: PNG.byteLength }
  const rendition = await payload.create({
    collection: 'media',
    data: {},
    file: { ...file, name: 'clip-640w.png' },
  })
  const source = await payload.create({ collection: 'media', data: { alt: 'hero' }, file })
  // The stamp hook resets renditions on any write carrying a file, so link the
  // rendition with a second, file-less update — the same shape the job writes.
  await payload.update({
    id: source.id,
    collection: 'media',
    data: {
      renditions: [{ height: 360, preset: '640w', video: rendition.id, width: 640 }],
    } as never,
  })
  pageId = (await payload.create({ collection: 'pages', data: { hero: source.id } })).id
}, 120_000)

afterAll(() => {
  fs.rmSync(tmpDir, { force: true, recursive: true })
})

const hero = async (populate?: Record<string, unknown>): Promise<never> =>
  (
    (await payload.findByID({
      id: pageId,
      collection: 'pages',
      depth: 2,
      ...(populate ? { populate: populate as never } : {}),
    })) as never as { hero: never }
  ).hero

/** The set the README documents: renditions, plus what a <source> is built from. */
const RECIPE = { filename: true, mimeType: true, renditions: true, url: true }

describe('the README populate recipe', () => {
  it('serves the ladder with the original as the fallback', async () => {
    const doc = await hero({ media: RECIPE })

    expect(getVideoSourceSet(doc, { sizes: '100vw' }).map((source) => source.preset)).toEqual([
      '640w',
      null, // the original, always last
    ])
  })

  it('serves only the original when renditions is left out', async () => {
    // The first trap: renditions is not a relationship, so it is easy to drop when
    // trimming a populate list — and populate is an allowlist, not a hint.
    const doc = await hero({ media: { filename: true, mimeType: true, url: true } })

    expect((doc as { renditions?: unknown }).renditions).toBeUndefined()
    expect(getVideoSourceSet(doc, { sizes: '100vw' }).map((source) => source.preset)).toEqual([
      null,
    ])
  })

  it('serves nothing at all when filename is left out, because url derives from it', async () => {
    // The second trap, and the worse one: `url` is virtual, computed from `filename`.
    // Name `url` without `filename` and every url — source and renditions alike —
    // comes back null, so even the original fallback disappears.
    const doc = await hero({ media: { mimeType: true, renditions: true, url: true } })

    expect((doc as { url: unknown }).url).toBeNull()
    expect(getVideoSourceSet(doc, { sizes: '100vw' })).toEqual([])
  })

  it('applies the same field list to the renditions, since a rendition is a media doc', async () => {
    const doc = await hero({ media: RECIPE })
    const rendition = (doc as { renditions: { video: { url: string } }[] }).renditions[0]

    expect(rendition?.video.url).toBe('http://localhost:3000/api/media/file/clip-640w.png')
  })
})

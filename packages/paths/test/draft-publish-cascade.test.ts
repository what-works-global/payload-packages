/**
 * Regression coverage for the draft → publish lifecycle, the case the main
 * suite's single-step `draft: false` updates never exercised.
 *
 * Payload keeps the main (published) row untouched during a draft-only save and
 * writes the change to a version instead — so editing a published document's
 * slug or parent as a draft does NOT move its live URL until publish. The catch
 * is that on the *publish*, `afterChange`'s `previousDoc` is the prior draft
 * (which already carries the new path), so a naive `oldPath !== newPath` check
 * reads false and the internal cascade would skip a stale subtree. These tests
 * pin the corrected behavior — including the exact `payload.update({ draft:
 * true })` shape `payload-nested-docs-page-tree`'s move endpoint uses.
 *
 * The `parent` strategy runs this package's own cascade; `pages` (nested-docs)
 * delegates the cascade to the nested-docs plugin. Both are covered so the two
 * cascade owners stay in lock-step.
 */
import type { Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createParentField, definePathsConfig, pathsPlugin } from '../src/index.js'

const titleAndSlug = [
  { name: 'title', type: 'text' as const, required: true },
  { name: 'slug', type: 'text' as const, required: true },
]

const pathsConfig = definePathsConfig({
  collections: {
    docs: { strategy: 'parent' },
    pages: {},
  },
})

let payload: Payload
let destroy: () => Promise<void>

beforeAll(async () => {
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-paths-draftpub-'))
  const dbFile = path.join(tmpDir, 'test.db')
  const config = await buildConfig({
    collections: [
      { slug: 'pages', fields: [...titleAndSlug], versions: { drafts: true } },
      {
        slug: 'docs',
        fields: [...titleAndSlug, createParentField('docs')],
        versions: { drafts: true },
      },
    ],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` }, push: true }),
    plugins: [
      nestedDocsPlugin({ collections: ['pages'] }),
      pathsPlugin({ ...pathsConfig, backfill: 'off' }),
    ],
    secret: 'draftpub-secret',
    telemetry: false,
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config, key: tmpDir })
  destroy = async () => {
    if (typeof payload?.db?.destroy === 'function') {
      await payload.db.destroy()
    }
    fs.rmSync(tmpDir, { force: true, recursive: true })
  }
})

afterAll(async () => {
  await destroy?.()
})

const pathOf = async (
  collection: 'docs' | 'pages',
  id: number | string,
  draft = false,
): Promise<null | string> => {
  const doc = await payload.findByID({ id, collection, draft })
  return (doc.path as null | string) ?? null
}

describe('parent strategy (internal cascade)', () => {
  it('a draft-only rename leaves the published URL live and untouched', async () => {
    const parent = await payload.create({
      collection: 'docs',
      data: { slug: 'dp-parent', _status: 'published', title: 'P' },
      draft: false,
    })
    const child = await payload.create({
      collection: 'docs',
      data: { slug: 'dp-child', _status: 'published', parent: parent.id, title: 'C' },
      draft: false,
    })
    expect(child.path).toBe('/dp-parent/dp-child')

    await payload.update({
      id: parent.id,
      collection: 'docs',
      data: { slug: 'dp-renamed' },
      draft: true,
    })

    // Published (main-row) view is unchanged; only the draft version moves.
    expect(await pathOf('docs', parent.id)).toBe('/dp-parent')
    expect(await pathOf('docs', child.id)).toBe('/dp-parent/dp-child')
    expect(await pathOf('docs', parent.id, true)).toBe('/dp-renamed')
  })

  it('publishing a draft rename cascades to descendants', async () => {
    const parent = await payload.create({
      collection: 'docs',
      data: { slug: 'pub-parent', _status: 'published', title: 'P' },
      draft: false,
    })
    const child = await payload.create({
      collection: 'docs',
      data: { slug: 'pub-child', _status: 'published', parent: parent.id, title: 'C' },
      draft: false,
    })
    const grand = await payload.create({
      collection: 'docs',
      data: { slug: 'pub-grand', _status: 'published', parent: child.id, title: 'G' },
      draft: false,
    })
    expect(grand.path).toBe('/pub-parent/pub-child/pub-grand')

    // Stage the rename as a draft (no cascade yet), then publish.
    await payload.update({
      id: parent.id,
      collection: 'docs',
      data: { slug: 'pub-renamed' },
      draft: true,
    })
    await payload.update({
      id: parent.id,
      collection: 'docs',
      data: { _status: 'published' },
      draft: false,
    })

    expect(await pathOf('docs', parent.id)).toBe('/pub-renamed')
    expect(await pathOf('docs', child.id)).toBe('/pub-renamed/pub-child')
    expect(await pathOf('docs', grand.id)).toBe('/pub-renamed/pub-child/pub-grand')
  })

  it('a page-tree move (reparent as a draft) regenerates the whole subtree on publish', async () => {
    const a = await payload.create({
      collection: 'docs',
      data: { slug: 'mv-a', _status: 'published', title: 'A' },
      draft: false,
    })
    const b = await payload.create({
      collection: 'docs',
      data: { slug: 'mv-b', _status: 'published', title: 'B' },
      draft: false,
    })
    const mid = await payload.create({
      collection: 'docs',
      data: { slug: 'mv-mid', _status: 'published', parent: a.id, title: 'Mid' },
      draft: false,
    })
    const leaf = await payload.create({
      collection: 'docs',
      data: { slug: 'mv-leaf', _status: 'published', parent: mid.id, title: 'Leaf' },
      draft: false,
    })
    expect(leaf.path).toBe('/mv-a/mv-mid/mv-leaf')

    // Exactly what createMovePageEndpoint issues on a drafts collection.
    await payload.update({
      id: mid.id,
      collection: 'docs',
      data: { parent: b.id },
      draft: true,
    })
    // Live paths stay put until the move is published.
    expect(await pathOf('docs', mid.id)).toBe('/mv-a/mv-mid')
    expect(await pathOf('docs', leaf.id)).toBe('/mv-a/mv-mid/mv-leaf')

    await payload.update({
      id: mid.id,
      collection: 'docs',
      data: { _status: 'published' },
      draft: false,
    })
    expect(await pathOf('docs', mid.id)).toBe('/mv-b/mv-mid')
    expect(await pathOf('docs', leaf.id)).toBe('/mv-b/mv-mid/mv-leaf')
  })
})

describe('nested-docs strategy (nested-docs cascade parity)', () => {
  it('publishing a draft rename cascades to descendants', async () => {
    await payload.create({
      collection: 'pages',
      data: { slug: 'home', _status: 'published', title: 'Home' },
      draft: false,
    })
    const parent = await payload.create({
      collection: 'pages',
      data: { slug: 'np-parent', _status: 'published', title: 'P' },
      draft: false,
    })
    const child = await payload.create({
      collection: 'pages',
      data: { slug: 'np-child', _status: 'published', parent: parent.id, title: 'C' },
      draft: false,
    })
    expect(child.path).toBe('/np-parent/np-child')

    await payload.update({
      id: parent.id,
      collection: 'pages',
      data: { slug: 'np-renamed' },
      draft: true,
    })
    await payload.update({
      id: parent.id,
      collection: 'pages',
      data: { _status: 'published' },
      draft: false,
    })

    expect(await pathOf('pages', parent.id)).toBe('/np-renamed')
    expect(await pathOf('pages', child.id)).toBe('/np-renamed/np-child')
  })

  it('a page-tree move (reparent as a draft) regenerates the subtree on publish', async () => {
    const a = await payload.create({
      collection: 'pages',
      data: { slug: 'nmv-a', _status: 'published', title: 'A' },
      draft: false,
    })
    const b = await payload.create({
      collection: 'pages',
      data: { slug: 'nmv-b', _status: 'published', title: 'B' },
      draft: false,
    })
    const mid = await payload.create({
      collection: 'pages',
      data: { slug: 'nmv-mid', _status: 'published', parent: a.id, title: 'Mid' },
      draft: false,
    })
    const leaf = await payload.create({
      collection: 'pages',
      data: { slug: 'nmv-leaf', _status: 'published', parent: mid.id, title: 'Leaf' },
      draft: false,
    })
    expect(leaf.path).toBe('/nmv-a/nmv-mid/nmv-leaf')

    await payload.update({
      id: mid.id,
      collection: 'pages',
      data: { parent: b.id },
      draft: true,
    })
    await payload.update({
      id: mid.id,
      collection: 'pages',
      data: { _status: 'published' },
      draft: false,
    })

    expect(await pathOf('pages', mid.id)).toBe('/nmv-b/nmv-mid')
    expect(await pathOf('pages', leaf.id)).toBe('/nmv-b/nmv-mid/nmv-leaf')
  })
})

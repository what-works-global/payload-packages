import type { BasePayload } from 'payload'

import { expect, it } from 'vitest'

import type { CopyConfig } from '../../src/types.js'

interface CopyConfigContext {
  runCopy: (copyConfig?: CopyConfig) => Promise<void>
  sourcePayload: BasePayload
  targetPayload: BasePayload
}

/**
 * Registers documents/versions config-matrix scenarios as `it` blocks in the
 * surrounding describe. Each scenario exercises one CopyConfig axis at a time:
 * default mode, per-collection overrides, and per-global overrides — across
 * both documents and versions.
 */
export const registerCopyConfigScenarios = (
  getContext: () => CopyConfigContext,
): void => {
  // ------------------------------------------------------------------
  // versions matrix
  // ------------------------------------------------------------------

  it('versions.default mode=none keeps only the latest version per parent', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    const post = await sourcePayload.create({
      collection: 'posts',
      data: { title: 'v1' },
    })
    await sourcePayload.update({ id: post.id, collection: 'posts', data: { title: 'v2' } })
    await sourcePayload.update({ id: post.id, collection: 'posts', data: { title: 'v3' } })

    await runCopy({
      documents: { default: { mode: 'all' } },
      versions: { default: { mode: 'none' } },
    })

    const targetVersions = await targetPayload.findVersions({
      collection: 'posts',
      limit: 100,
      where: { parent: { equals: post.id } },
    })

    expect(targetVersions.totalDocs).toBe(1)
    expect((targetVersions.docs[0]?.version as { title?: string }).title).toBe('v3')
  })

  it('versions per-collection latest-x override applies to that collection only', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    const post = await sourcePayload.create({
      collection: 'posts',
      data: { title: 'v1' },
    })
    for (const title of ['v2', 'v3', 'v4', 'v5']) {
      await sourcePayload.update({ id: post.id, collection: 'posts', data: { title } })
    }

    await runCopy({
      documents: { default: { mode: 'all' } },
      versions: {
        collections: { posts: { mode: 'latest-x', x: 3 } },
        default: { mode: 'all' },
      },
    })

    const targetVersions = await targetPayload.findVersions({
      collection: 'posts',
      limit: 100,
      where: { parent: { equals: post.id } },
    })

    expect(targetVersions.totalDocs).toBe(3)
    const titles = targetVersions.docs
      .map((v) => (v.version as { title?: string }).title)
      .sort()
    expect(titles).toEqual(['v3', 'v4', 'v5'])
  })

  it('versions per-collection all override beats a strict default', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    const post = await sourcePayload.create({
      collection: 'posts',
      data: { title: 'v1' },
    })
    await sourcePayload.update({ id: post.id, collection: 'posts', data: { title: 'v2' } })
    await sourcePayload.update({ id: post.id, collection: 'posts', data: { title: 'v3' } })

    const sourceVersions = await sourcePayload.findVersions({
      collection: 'posts',
      limit: 100,
      where: { parent: { equals: post.id } },
    })
    expect(sourceVersions.totalDocs).toBeGreaterThanOrEqual(3)

    await runCopy({
      documents: { default: { mode: 'all' } },
      versions: {
        collections: { posts: { mode: 'all' } },
        default: { mode: 'none' },
      },
    })

    const targetVersions = await targetPayload.findVersions({
      collection: 'posts',
      limit: 100,
      where: { parent: { equals: post.id } },
    })
    expect(targetVersions.totalDocs).toBe(sourceVersions.totalDocs)
  })

  it('versions per-collection none override (collection-scoped latest-only)', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    const post = await sourcePayload.create({
      collection: 'posts',
      data: { title: 'v1' },
    })
    await sourcePayload.update({ id: post.id, collection: 'posts', data: { title: 'v2' } })
    await sourcePayload.update({ id: post.id, collection: 'posts', data: { title: 'v3' } })

    await runCopy({
      documents: { default: { mode: 'all' } },
      versions: {
        collections: { posts: { mode: 'none' } },
        default: { mode: 'all' },
      },
    })

    const targetVersions = await targetPayload.findVersions({
      collection: 'posts',
      limit: 100,
      where: { parent: { equals: post.id } },
    })
    expect(targetVersions.totalDocs).toBe(1)
    expect((targetVersions.docs[0]?.version as { title?: string }).title).toBe('v3')
  })

  // ------------------------------------------------------------------
  // documents matrix
  // ------------------------------------------------------------------

  it('documents.default latest-x keeps only the newest N base docs', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    for (const title of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      await sourcePayload.create({ collection: 'posts', data: { title } })
    }

    await runCopy({
      documents: { default: { mode: 'latest-x', x: 2 } },
      versions: { default: { mode: 'none' } },
    })

    const targetPosts = await targetPayload.find({ collection: 'posts', limit: 100 })
    expect(targetPosts.totalDocs).toBe(2)
    expect(targetPosts.docs.map((d) => d.title).sort()).toEqual(['p4', 'p5'])
  })

  it('documents per-collection latest-x override applies to that collection only', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    for (const title of ['p1', 'p2', 'p3', 'p4']) {
      await sourcePayload.create({ collection: 'posts', data: { title } })
    }
    await sourcePayload.create({ collection: 'authors', data: { name: 'a1' } })
    await sourcePayload.create({ collection: 'authors', data: { name: 'a2' } })

    await runCopy({
      documents: {
        collections: { posts: { mode: 'latest-x', x: 2 } },
        default: { mode: 'all' },
      },
      versions: { default: { mode: 'none' } },
    })

    const targetPosts = await targetPayload.find({ collection: 'posts', limit: 100 })
    expect(targetPosts.totalDocs).toBe(2)
    expect(targetPosts.docs.map((d) => d.title).sort()).toEqual(['p3', 'p4'])

    const targetAuthors = await targetPayload.find({ collection: 'authors', limit: 100 })
    expect(targetAuthors.totalDocs).toBe(2)
  })

  it('documents per-collection all override beats a strict default', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    for (const title of ['p1', 'p2', 'p3']) {
      await sourcePayload.create({ collection: 'posts', data: { title } })
    }
    await sourcePayload.create({ collection: 'authors', data: { name: 'a1' } })
    await sourcePayload.create({ collection: 'authors', data: { name: 'a2' } })

    await runCopy({
      documents: {
        collections: { posts: { mode: 'all' } },
        default: { mode: 'latest-x', x: 1 },
      },
      versions: { default: { mode: 'none' } },
    })

    const targetPosts = await targetPayload.find({ collection: 'posts', limit: 100 })
    expect(targetPosts.totalDocs).toBe(3)
    expect(targetPosts.docs.map((d) => d.title).sort()).toEqual(['p1', 'p2', 'p3'])

    const targetAuthors = await targetPayload.find({ collection: 'authors', limit: 100 })
    expect(targetAuthors.totalDocs).toBe(1)
    expect(targetAuthors.docs[0]?.name).toBe('a2')
  })

  it('documents per-collection none override (collection-scoped skip)', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    for (const title of ['p1', 'p2']) {
      await sourcePayload.create({ collection: 'posts', data: { title } })
    }
    await sourcePayload.create({ collection: 'authors', data: { name: 'a1' } })

    await runCopy({
      documents: {
        collections: { posts: { mode: 'none' } },
        default: { mode: 'all' },
      },
      versions: { default: { mode: 'none' } },
    })

    const targetPosts = await targetPayload.find({ collection: 'posts', limit: 100 })
    expect(targetPosts.totalDocs).toBe(0)

    const targetAuthors = await targetPayload.find({ collection: 'authors', limit: 100 })
    expect(targetAuthors.totalDocs).toBe(1)
  })

  // ------------------------------------------------------------------
  // globals matrix
  // ------------------------------------------------------------------

  it('per-global documents none override skips that global', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await sourcePayload.updateGlobal({
      slug: 'site-settings',
      data: { siteName: 'SOURCE_NAME', tagline: 'SOURCE_TAGLINE' },
    })

    await runCopy({
      documents: {
        default: { mode: 'all' },
        globals: { 'site-settings': { mode: 'none' } },
      },
      versions: { default: { mode: 'none' } },
    })

    const after = await targetPayload.findGlobal({ slug: 'site-settings' })
    expect(after.siteName).not.toBe('SOURCE_NAME')
    expect(after.tagline).not.toBe('SOURCE_TAGLINE')
  })

  it('per-global documents latest-x override applied to a singleton global', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    await sourcePayload.updateGlobal({
      slug: 'site-settings',
      data: { siteName: 'LX_NAME', tagline: 'LX_TAGLINE' },
    })

    // latest-x with x=1 on a singleton global should still copy the one row.
    await runCopy({
      documents: {
        default: { mode: 'none' },
        globals: { 'site-settings': { mode: 'latest-x', x: 1 } },
      },
      versions: { default: { mode: 'none' } },
    })

    const after = await targetPayload.findGlobal({ slug: 'site-settings' })
    expect(after.siteName).toBe('LX_NAME')
    expect(after.tagline).toBe('LX_TAGLINE')
  })
}

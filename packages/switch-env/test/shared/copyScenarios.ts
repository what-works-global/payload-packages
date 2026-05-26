import type { BasePayload } from 'payload'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { CopyConfig } from '../../src/types.js'

import { registerCopyConfigScenarios } from './copyConfigScenarios.js'
import { registerKitchenSinkScenarios } from './kitchenSinkScenarios.js'

export interface CopyAdapterFixture {
  /**
   * Runs the adapter's backup followed by the adapter's restore. The shared
   * scenarios call this to perform a copy; differences in adapter shape are
   * absorbed here.
   */
  copy: (
    source: BasePayload,
    target: BasePayload,
    opts: { copyConfig: CopyConfig },
  ) => Promise<void>
  /** Display name used in the describe block. */
  name: string
  /** Boots a source + target Payload pair on the adapter under test. */
  setupPayloads: () => Promise<{
    cleanup: () => Promise<void>
    sourcePayload: BasePayload
    targetPayload: BasePayload
  }>
}

export interface CopyScenarioContext {
  runCopy: (copyConfig?: CopyConfig) => Promise<void>
  sourcePayload: BasePayload
  targetPayload: BasePayload
}

export interface RunCopyScenariosOptions {
  /**
   * Add additional adapter-specific test cases inside the same describe block
   * (no extra boot). The callback receives a getter for the live context
   * because `beforeAll` runs after the describe body.
   */
  extras?: (getContext: () => CopyScenarioContext) => void
}

const ALL_DOCUMENTS: CopyConfig = { documents: { default: { mode: 'all' } } }

export const runCopyScenarios = (
  fixture: CopyAdapterFixture,
  options: RunCopyScenariosOptions = {},
): void => {
  describe(`copy scenarios (${fixture.name})`, () => {
    let sourcePayload: BasePayload
    let targetPayload: BasePayload
    let cleanup: (() => Promise<void>) | undefined

    beforeAll(async () => {
      const setup = await fixture.setupPayloads()
      sourcePayload = setup.sourcePayload
      targetPayload = setup.targetPayload
      cleanup = setup.cleanup
    })

    afterAll(async () => {
      await cleanup?.()
    })

    afterEach(async () => {
      for (const slug of ['posts', 'authors', 'kitchen-sink'] as const) {
        await sourcePayload.delete({ collection: slug, where: { id: { exists: true } } })
        await targetPayload.delete({ collection: slug, where: { id: { exists: true } } })
      }
    })

    const runCopy = (copyConfig: CopyConfig = ALL_DOCUMENTS) =>
      fixture.copy(sourcePayload, targetPayload, { copyConfig })

    const getContext = (): CopyScenarioContext => ({
      runCopy,
      sourcePayload,
      targetPayload,
    })

    it('copies a single collection document from source to target', async () => {
      await sourcePayload.create({
        collection: 'posts',
        data: { body: 'body 1', title: 'hello from source' },
      })

      const before = await targetPayload.find({ collection: 'posts' })
      expect(before.totalDocs).toBe(0)

      await runCopy()

      const after = await targetPayload.find({ collection: 'posts' })
      expect(after.totalDocs).toBeGreaterThanOrEqual(1)
      const match = after.docs.find((d) => d.title === 'hello from source')
      expect(match?.title).toBe('hello from source')
    })

    it('preserves relationship IDs across the copy', async () => {
      const author = await sourcePayload.create({
        collection: 'authors',
        data: { name: 'Ada Lovelace' },
      })
      const post = await sourcePayload.create({
        collection: 'posts',
        data: { author: author.id, title: 'with author' },
      })

      await runCopy()

      const targetPost = await targetPayload.findByID({
        id: post.id,
        collection: 'posts',
        depth: 1,
      })
      expect(targetPost.id).toBe(post.id)
      const targetAuthor = targetPost.author as { id: number | string; name: string }
      expect(targetAuthor?.id).toBe(author.id)
      expect(targetAuthor?.name).toBe('Ada Lovelace')
    })

    it('copies only the latest-x versions of a document', async () => {
      const post = await sourcePayload.create({
        collection: 'posts',
        data: { title: 'v1' },
      })
      await sourcePayload.update({
        id: post.id,
        collection: 'posts',
        data: { title: 'v2' },
      })
      await sourcePayload.update({
        id: post.id,
        collection: 'posts',
        data: { title: 'v3' },
      })

      const sourceVersions = await sourcePayload.findVersions({
        collection: 'posts',
        limit: 100,
        where: { parent: { equals: post.id } },
      })
      expect(sourceVersions.totalDocs).toBeGreaterThanOrEqual(3)

      await runCopy({
        documents: { default: { mode: 'all' } },
        versions: { default: { mode: 'latest-x', x: 2 } },
      })

      const targetVersions = await targetPayload.findVersions({
        collection: 'posts',
        limit: 100,
        where: { parent: { equals: post.id } },
      })
      expect(targetVersions.totalDocs).toBe(2)

      const titles = targetVersions.docs
        .map((v) => (v.version as { title?: string }).title)
        .sort()
      expect(titles).toEqual(['v2', 'v3'])
    })

    it('respects per-collection documents override', async () => {
      await sourcePayload.create({
        collection: 'authors',
        data: { name: 'should be skipped' },
      })
      await sourcePayload.create({
        collection: 'posts',
        data: { title: 'should be copied' },
      })

      await runCopy({
        documents: {
          collections: { authors: { mode: 'none' } },
          default: { mode: 'all' },
        },
        versions: { default: { mode: 'all' } },
      })

      const targetPosts = await targetPayload.find({ collection: 'posts' })
      expect(targetPosts.totalDocs).toBeGreaterThanOrEqual(1)

      const targetAuthors = await targetPayload.find({ collection: 'authors' })
      expect(targetAuthors.totalDocs).toBe(0)
    })

    it('copies a global from source to target', async () => {
      await sourcePayload.updateGlobal({
        slug: 'site-settings',
        data: { siteName: 'Source Site', tagline: 'from prod' },
      })

      await runCopy()

      const after = await targetPayload.findGlobal({ slug: 'site-settings' })
      expect(after.siteName).toBe('Source Site')
      expect(after.tagline).toBe('from prod')
    })

    it('wipes pre-existing target rows before restoring', async () => {
      // Make sure source has something so restore actually inserts.
      await sourcePayload.create({
        collection: 'posts',
        data: { title: 'from source' },
      })

      // Seed target with a title that doesn't exist on source. We assert by
      // title rather than id because sqlite auto-increment IDs from source can
      // collide with the target-only id after restore.
      const uniqueTitle = `wipe-marker-${Math.random().toString(36).slice(2, 10)}`
      await targetPayload.create({
        collection: 'posts',
        data: { title: uniqueTitle },
      })

      await runCopy()

      const after = await targetPayload.find({
        collection: 'posts',
        where: { title: { equals: uniqueTitle } },
      })
      expect(after.totalDocs).toBe(0)
    })

    registerKitchenSinkScenarios(getContext)
    registerCopyConfigScenarios(getContext)

    if (options.extras) {
      options.extras(getContext)
    }
  })
}

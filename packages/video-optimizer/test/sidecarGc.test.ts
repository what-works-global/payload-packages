/**
 * Pins the garbage-collection contract, which is the plugin's only data-loss path.
 *
 * The rule is narrow and easy to break by accident: a write may only collect
 * renditions if it *genuinely retires* them — a new file, the plugin's own job
 * update, or the regenerate endpoint. Every other write (a plain save, a restored
 * version, a duplicate) carries an older snapshot of `renditions` through no fault
 * of the renditions, and acting on it deletes live files.
 *
 * Exercised against the hooks directly rather than through a Payload boot, so each
 * branch is named and the whole contract runs in milliseconds.
 */
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, JsonObject } from 'payload'

import { describe, expect, it } from 'vitest'

import { createSidecarCleanupHook, createSidecarDeleteHook } from '../src/hooks/sidecar.js'
import { GC_CONTEXT_KEY, SKIP_CONTEXT_KEY } from '../src/hooks/shared.js'

const rows = (...ids: number[]): JsonObject => ({
  renditions: ids.map((id) => ({ preset: `${id}w`, video: id })),
})

/** Collects the ids a hook tries to delete, without a database in sight. */
const fakeReq = (context: JsonObject = {}, file?: unknown) => {
  const deleted: unknown[] = []
  return {
    deleted,
    req: {
      context,
      file,
      payload: {
        delete: ({ id }: { id: unknown }) => {
          deleted.push(id)
          return Promise.resolve({})
        },
        logger: { warn: () => {} },
      },
    } as never,
  }
}

const runCleanup = async (
  doc: JsonObject,
  previousDoc: JsonObject,
  context: JsonObject = {},
  file?: unknown,
): Promise<unknown[]> => {
  const { deleted, req } = fakeReq(context, file)
  const hook = createSidecarCleanupHook() as CollectionAfterChangeHook
  await hook({ collection: { slug: 'media' }, doc, previousDoc, req } as never)
  return deleted
}

describe('rendition garbage collection', () => {
  it('collects renditions the new file retired', async () => {
    // Replacing the upload is the canonical retiring write: the old renditions are
    // of a file that no longer exists.
    expect(await runCleanup(rows(3), rows(1, 2, 3), {}, { name: 'new.mp4' })).toEqual([1, 2])
  })

  it("collects on the plugin's own job update", async () => {
    expect(await runCleanup(rows(3), rows(1, 3), { [SKIP_CONTEXT_KEY]: true })).toEqual([1])
  })

  it('collects on the regenerate endpoint', async () => {
    expect(await runCleanup(rows(), rows(1, 2), { [GC_CONTEXT_KEY]: true })).toEqual([1, 2])
  })

  it('does NOT collect on an ordinary save', async () => {
    // No file, no plugin context. Even though this write's `renditions` is missing
    // rows the previous document had, those rows are live files.
    expect(await runCleanup(rows(3), rows(1, 2, 3))).toEqual([])
  })

  it('does NOT collect when a stale snapshot restores older rows', async () => {
    // A restored version, or a document duplicated from one that had renditions:
    // `renditions` moves backwards through no fault of the renditions themselves.
    expect(await runCleanup(rows(1), rows(1, 2, 3))).toEqual([])
    expect(await runCleanup(rows(), rows(1))).toEqual([])
  })

  it('collects nothing when the rows did not change', async () => {
    expect(await runCleanup(rows(1, 2), rows(1, 2), {}, { name: 'new.mp4' })).toEqual([])
  })

  it('deleting the original deletes every rendition', async () => {
    const { deleted, req } = fakeReq()
    const hook = createSidecarDeleteHook() as CollectionAfterDeleteHook
    await hook({ collection: { slug: 'media' }, doc: rows(1, 2, 3), req } as never)
    expect(deleted).toEqual([1, 2, 3])
  })

  it('a sidecar deleting itself does not recurse', async () => {
    const { deleted, req } = fakeReq({ [SKIP_CONTEXT_KEY]: true })
    const hook = createSidecarDeleteHook() as CollectionAfterDeleteHook
    await hook({ collection: { slug: 'media' }, doc: rows(1), req } as never)
    expect(deleted).toEqual([])
  })
})

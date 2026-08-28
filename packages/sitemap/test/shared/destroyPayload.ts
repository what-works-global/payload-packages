import type { Payload } from 'payload'

/**
 * `payload.destroy()` was added after 3.30.0 — this package's declared peer
 * floor (`whatworks.peerMatrix.payload.min`) — so the pinned-payload CI matrix
 * runs these tests against a Payload that does not have it. Fall back to
 * tearing down the database adapter, which has existed across the whole
 * supported range.
 */
export const destroyPayload = async (instance: Payload | undefined): Promise<void> => {
  if (typeof instance?.destroy === 'function') {
    await instance.destroy()
    return
  }

  await instance?.db?.destroy?.()
}

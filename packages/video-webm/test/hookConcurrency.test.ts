import type { CollectionBeforeOperationHook, PayloadRequest } from 'payload'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConversionRecord } from '../src/types.js'

import { resolveConfig } from '../src/core/defaults.js'
import { Semaphore } from '../src/core/semaphore.js'
import { createConvertHook, VIDEO_WEBM_CONTEXT_KEY } from '../src/hooks/convertUploadedVideo.js'

let fixtureDir: string
let failingBinary: string
let sleepingBinary: string

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-webm-permits-'))
  failingBinary = path.join(fixtureDir, 'failing-ffmpeg')
  fs.writeFileSync(failingBinary, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  sleepingBinary = path.join(fixtureDir, 'sleeping-ffmpeg')
  fs.writeFileSync(sleepingBinary, '#!/bin/sh\nsleep 60\n', { mode: 0o755 })
})

afterAll(() => {
  fs.rmSync(fixtureDir, { force: true, recursive: true })
})

const noop = () => undefined

/** Minimal stand-in for the slice of PayloadRequest the hook touches. */
const makeReq = (name: string) => {
  const req = {
    context: {} as Record<string, unknown>,
    file: {
      name,
      data: Buffer.from('not really a video'),
      mimetype: 'video/mp4',
      size: 18,
    },
    payload: { logger: { error: noop, info: noop, warn: noop } },
  }
  return req as unknown as { context: Record<string, unknown> } & PayloadRequest
}

type HookArgs = Parameters<CollectionBeforeOperationHook>[0]

const invoke = (hook: CollectionBeforeOperationHook, req: PayloadRequest) =>
  hook({
    args: {},
    collection: { slug: 'videos' },
    context: {},
    operation: 'create',
    req,
  } as unknown as HookArgs)

const recordOf = (req: { context: Record<string, unknown> }): ConversionRecord | undefined =>
  req.context[VIDEO_WEBM_CONTEXT_KEY] as ConversionRecord | undefined

describe.skipIf(process.platform === 'win32')('semaphore permit lifecycle in the hook', () => {
  it('releases the permit when the encode fails, letting the next upload proceed', async () => {
    const limiter = new Semaphore(1)
    const hook = createConvertHook(
      resolveConfig({ ffmpegPath: failingBinary, onError: 'skip' }),
      limiter,
    )

    // With a leaked permit the second invocation would wait forever and trip the
    // test timeout — completion of both is the regression assertion.
    const first = makeReq('first.mp4')
    const second = makeReq('second.mp4')
    await Promise.all([invoke(hook, first), invoke(hook, second)])

    expect(recordOf(first)).toMatchObject({ skippedReason: 'ffmpeg-failed' })
    expect(recordOf(second)).toMatchObject({ skippedReason: 'ffmpeg-failed' })
  })

  it('releases the permit when the encode times out', async () => {
    const limiter = new Semaphore(1)
    // Two hooks sharing one limiter, mirroring per-collection configs in the plugin.
    const timingOut = createConvertHook(
      resolveConfig({ ffmpegPath: sleepingBinary, onError: 'skip', timeoutMs: 200 }),
      limiter,
    )
    const failing = createConvertHook(
      resolveConfig({ ffmpegPath: failingBinary, onError: 'skip' }),
      limiter,
    )

    const startedAt = Date.now()
    const first = makeReq('wedged.mp4')
    const second = makeReq('queued.mp4')
    await Promise.all([invoke(timingOut, first), invoke(failing, second)])

    // Both finished promptly: the timed-out encode's permit was handed on, not
    // held for the fake binary's 60s sleep.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(recordOf(first)).toMatchObject({ skippedReason: 'ffmpeg-failed' })
    expect(recordOf(second)).toMatchObject({ skippedReason: 'ffmpeg-failed' })
  })

  it("releases the permit when onError: 'throw' rejects the upload", async () => {
    const limiter = new Semaphore(1)
    const hook = createConvertHook(resolveConfig({ ffmpegPath: failingBinary }), limiter)

    await expect(invoke(hook, makeReq('boom.mp4'))).rejects.toThrow(/failed to convert/)

    // The permit must be free again for the next upload.
    const next = makeReq('after.mp4')
    await expect(invoke(hook, next)).rejects.toThrow(/failed to convert/)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { convertToWebm, FfmpegError } from '../src/core/convert.js'
import { resolveConfig } from '../src/core/defaults.js'

let fixtureDir: string
/** Stand-in "ffmpeg" that hangs forever — exercises the timeout kill path without ffmpeg. */
let sleepingBinary: string

/**
 * Leak detection needs an isolated tmpdir — other test files convert real videos
 * into the shared os.tmpdir() concurrently, so counting there is racy. Stubbing
 * os.tmpdir() points convertToWebm's mkdtemp at this file's own directory.
 */
const countTempDirs = (): number =>
  fs.readdirSync(fixtureDir).filter((name) => name.startsWith('payload-video-webm-')).length

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-webm-fakebin-'))
  sleepingBinary = path.join(fixtureDir, 'fake-ffmpeg')
  fs.writeFileSync(sleepingBinary, '#!/bin/sh\nsleep 60\n', { mode: 0o755 })
  vi.spyOn(os, 'tmpdir').mockReturnValue(fixtureDir)
})

afterAll(() => {
  vi.restoreAllMocks()
  fs.rmSync(fixtureDir, { force: true, recursive: true })
})

const convertWith = (overrides: Parameters<typeof resolveConfig>[0]) =>
  convertToWebm({
    config: resolveConfig(overrides),
    data: Buffer.from('not a real video'),
    originalName: 'clip.mp4',
  })

describe.skipIf(process.platform === 'win32')('convertToWebm process handling', () => {
  it('kills a wedged encode at timeoutMs and reports the timeout', async () => {
    const before = countTempDirs()
    const startedAt = Date.now()

    await expect(
      convertWith({ ffmpeg: { path: sleepingBinary, timeoutMs: 300 } }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/timed out after 300ms/) as string })

    // Rejection must come from the kill, not the 60s sleep finishing.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(countTempDirs()).toBe(before)
  })

  it('reports an unspawnable binary as an FfmpegError and cleans temp files', async () => {
    const before = countTempDirs()

    const failure = await convertWith({
      ffmpeg: { path: path.join(fixtureDir, 'missing-ffmpeg') },
    }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(FfmpegError)
    expect((failure as FfmpegError).message).toMatch(/could not spawn ffmpeg/)
    expect(countTempDirs()).toBe(before)
  })

  it('cleans temp files when the binary exits non-zero', async () => {
    const failingBinary = path.join(fixtureDir, 'failing-ffmpeg')
    fs.writeFileSync(failingBinary, '#!/bin/sh\necho "boom" >&2\nexit 1\n', { mode: 0o755 })
    const before = countTempDirs()

    await expect(convertWith({ ffmpeg: { path: failingBinary } })).rejects.toMatchObject({
      message: expect.stringMatching(/exited with code 1[\s\S]*boom/) as string,
    })
    expect(countTempDirs()).toBe(before)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/core/defaults.js'
import { Semaphore } from '../src/core/semaphore.js'
import { encodeLimited } from '../src/hooks/shared.js'

let fixtureDir: string
let failingBinary: string
let sleepingBinary: string
let source: { inputPath: string; outputPath: string }

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-webm-permits-'))
  failingBinary = path.join(fixtureDir, 'failing-ffmpeg')
  fs.writeFileSync(failingBinary, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  sleepingBinary = path.join(fixtureDir, 'sleeping-ffmpeg')
  fs.writeFileSync(sleepingBinary, '#!/bin/sh\nsleep 60\n', { mode: 0o755 })

  const inputPath = path.join(fixtureDir, 'clip.mp4')
  fs.writeFileSync(inputPath, 'not really a video')
  source = { inputPath, outputPath: path.join(fixtureDir, 'out.webm') }
})

afterAll(() => {
  fs.rmSync(fixtureDir, { force: true, recursive: true })
})

const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    () => 'rejected',
  )

describe.skipIf(process.platform === 'win32')('semaphore permit lifecycle in encodeLimited', () => {
  it('releases the permit when the encode fails, letting the next encode proceed', async () => {
    const limiter = new Semaphore(1)
    const config = resolveConfig({ ffmpeg: { path: failingBinary  }})

    // With a leaked permit the second call would wait forever and trip the test
    // timeout — both settling is the regression assertion.
    const results = await Promise.all([
      settle(encodeLimited(config, limiter, source)),
      settle(encodeLimited(config, limiter, source)),
    ])
    expect(results).toEqual(['rejected', 'rejected'])
  })

  it('releases the permit when the encode times out', async () => {
    const limiter = new Semaphore(1)
    const timingOut = resolveConfig({ ffmpeg: { path: sleepingBinary, timeoutMs: 200 } })
    const failing = resolveConfig({ ffmpeg: { path: failingBinary  }})

    const startedAt = Date.now()
    const results = await Promise.all([
      settle(encodeLimited(timingOut, limiter, source)),
      settle(encodeLimited(failing, limiter, source)),
    ])

    // Both finished promptly: the timed-out encode's permit was handed on, not
    // held for the fake binary's 60s sleep.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(results).toEqual(['rejected', 'rejected'])
  })
})

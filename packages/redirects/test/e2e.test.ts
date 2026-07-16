/**
 * End-to-end test against a live dev sandbox. Skipped unless `E2E` is set
 * (`E2E=1 pnpm --filter @whatworks/payload-redirects test:e2e`).
 *
 * It boots the sandbox by spawning the leaf Next binary directly (no pnpm /
 * cross-env wrapper chain), in its own process group so teardown can kill the
 * whole tree — avoiding the orphaned high-CPU worker problem. The sandbox runs
 * against throwaway env-driven db/cache paths so a run never clobbers local dev
 * state, then real HTTP requests exercise the proxy end to end.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const E2E = Boolean(process.env.E2E)

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nextBin = path.join(packageDir, 'node_modules', '.bin', 'next')
const port = Number(process.env.E2E_PORT ?? 3765)
const baseUrl = `http://127.0.0.1:${port}`

let server: ChildProcess | undefined
let tmpDir: string | undefined
let serverLog = ''

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const get = (pathname: string) => fetch(`${baseUrl}${pathname}`, { redirect: 'manual' })

/** Poll a request until `check` passes or the deadline elapses. */
const pollUntil = async (
  timeoutMs: number,
  attempt: () => Promise<boolean>,
  label: string,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no successful response'
  while (Date.now() < deadline) {
    try {
      if (await attempt()) {
        return
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await wait(1000)
  }
  throw new Error(
    `${label} timed out (${lastError})\n--- next dev output ---\n${serverLog.slice(-4000)}`,
  )
}

describe.skipIf(!E2E)('redirects e2e (live sandbox)', () => {
  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redirects-e2e-'))

    server = spawn(nextBin, ['dev', 'dev', '-p', String(port)], {
      cwd: packageDir,
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        REDIRECTS_DEV_CACHE: path.join(tmpDir, 'redirects-cache.json'),
        REDIRECTS_DEV_DB: path.join(tmpDir, 'e2e.db'),
        // Stop Payload's dev HMR from spawning `generate:types` workers that the
        // process-group kill would orphan (known high-CPU zombie issue).
        REDIRECTS_DEV_DISABLE_AUTOGEN: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()))
    server.stderr?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()))

    // 1. Wait for Payload to boot, seed (onInit), and build the cache.
    await pollUntil(
      150_000,
      async () => {
        const res = await fetch(`${baseUrl}/api/payload-redirects/refresh-cache`, {
          method: 'POST',
        })
        return res.status === 200
      },
      'sandbox readiness (refresh-cache)',
    )

    // 2. Wait for the proxy to compile and read the freshly-built cache.
    await pollUntil(
      60_000,
      async () => (await get('/legacy-about')).status === 301,
      'proxy readiness (/legacy-about)',
    )
  }, 240_000)

  afterAll(async () => {
    if (server?.pid !== undefined) {
      try {
        // Kill the whole process group (detached leader) so no worker is orphaned.
        process.kill(-server.pid, 'SIGKILL')
      } catch {
        try {
          server.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
    }
    await wait(500)
    if (tmpDir) {
      fs.rmSync(tmpDir, { force: true, recursive: true })
    }
  })

  it('301s to an internal reference with a scrollTo fragment', async () => {
    const res = await get('/legacy-about')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toMatch(/\/about#team$/)
  })

  it('302s to an external URL', async () => {
    const res = await get('/search-engine')
    expect(res.status).toBe(302)
    expect(res.headers.get('location') ?? '').toMatch(/^https:\/\/www\.google\.com/)
  })

  it('substitutes a regex capture group into the destination', async () => {
    const res = await get('/posts/hello-world')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/\/hello-world$/)
  })

  it('matches a startsWith rule to its fixed destination', async () => {
    const res = await get('/section/some/deep/path')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toMatch(/\/new-section$/)
  })

  it('forwards the incoming query string when forwardQuery is set', async () => {
    const res = await get('/promo?utm_source=demo&ref=x')
    expect(res.status).toBe(301)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/campaign?')
    expect(location).toContain('utm_source=demo')
    expect(location).toContain('ref=x')
  })

  it('matches case-insensitively when caseInsensitive is set', async () => {
    const res = await get('/docs-legacy')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toMatch(/\/docs$/)
  })

  it('does not fire a disabled redirect', async () => {
    const res = await get('/disabled-redirect')
    expect([301, 302]).not.toContain(res.status)
  })

  it('keeps redirecting on repeated requests (hit-tracking loop stays healthy)', async () => {
    expect((await get('/legacy-about')).status).toBe(301)
    expect((await get('/legacy-about')).status).toBe(301)
  })
})

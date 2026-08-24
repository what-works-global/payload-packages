import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ResolvedVideoWebmConfig, VideoCodec } from '../types.js'

import { buildFfmpegArgs } from './args.js'

/** Trailing stderr kept for error messages — enough for ffmpeg's failure summary. */
const STDERR_TAIL_BYTES = 8_192

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FfmpegError'
  }
}

/** Resolves `true` when the binary responds to `-version` — cheap executability check. */
export const isFfmpegAvailable = (ffmpegPath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })

export interface FfmpegCheckResult {
  /** The binary exists, is executable, and exited cleanly. */
  available: boolean
  /** Required encoder names absent from `ffmpeg -encoders` (empty when `available` is false). */
  missingEncoders: string[]
}

export const requiredEncodersFor = (codecs: VideoCodec[]): string[] => {
  const encoders = new Set<string>(['libopus'])
  for (const codec of codecs) {
    encoders.add(codec === 'vp9' ? 'libvpx-vp9' : 'libvpx')
  }
  return [...encoders]
}

/** Bound on the boot-time probe so a pathological binary can never hang onInit. */
const CHECK_TIMEOUT_MS = 10_000

/**
 * Boot-time health check: verifies the binary runs and that the encoders the
 * configuration needs are compiled in — one `ffmpeg -encoders` spawn, so a bad
 * install surfaces in the logs at init instead of on the first editor upload.
 */
export const checkFfmpeg = (
  ffmpegPath: string,
  requiredEncoders: string[],
): Promise<FfmpegCheckResult> =>
  new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      child.stdout.destroy()
      resolve({ available: false, missingEncoders: [] })
    }, CHECK_TIMEOUT_MS)

    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.on('error', () => {
      clearTimeout(timer)
      resolve({ available: false, missingEncoders: [] })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve({ available: false, missingEncoders: [] })
        return
      }
      resolve({
        available: true,
        // The -encoders table delimits names with spaces; a plain includes() would
        // let "libvpx-vp9" satisfy a required "libvpx".
        missingEncoders: requiredEncoders.filter((name) => !stdout.includes(` ${name} `)),
      })
    })
  })

const runFfmpeg = (ffmpegPath: string, args: string[], timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })

    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES)
    })

    // SIGKILL, deliberately not SIGTERM-then-wait: it cannot be caught or ignored,
    // so a wedged encode (corrupt input, stuck filter) terminates deterministically.
    // The rejection happens here rather than in 'close' — 'close' also waits for
    // stdio to drain, which a leaked descendant holding the stderr pipe can stall.
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      child.stderr.destroy()
      reject(new FfmpegError(`ffmpeg timed out after ${timeoutMs}ms and was killed`))
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(
        new FfmpegError(
          `could not spawn ffmpeg at "${ffmpegPath}" — is it installed and on PATH, or set via the ffmpegPath option / FFMPEG_PATH? (${error.message})`,
        ),
      )
    })

    // A settled promise ignores later resolve/reject calls, so firing after a
    // timeout rejection is harmless.
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new FfmpegError(`ffmpeg exited with code ${code}:\n${stderrTail.trim()}`))
        return
      }
      resolve()
    })
  })

export interface ConvertToWebmOptions {
  config: Pick<ResolvedVideoWebmConfig, 'encoding' | 'ffmpegPath' | 'timeoutMs'>
  /** Buffer of the source video, used when no `inputPath` is given. */
  data: Buffer
  /** Existing on-disk copy of the source (Payload's `tempFilePath`) — saves a write. */
  inputPath?: string
  /** Original filename; only its extension is reused, on the temp input file. */
  originalName: string
}

/**
 * Only the (sanitized, length-capped) extension of the user filename reaches the
 * filesystem — ffmpeg probes input containers by content, so the rest of the name
 * carries no information and would only import length/encoding problems.
 */
const tempInputName = (originalName: string): string => {
  const ext = path.extname(path.basename(originalName))
  const safeExt = /^\.[\w-]{1,16}$/.test(ext) ? ext : ''
  return `input${safeExt}`
}

/**
 * Transcodes a video to WebM through temp files in a fresh `os.tmpdir()` directory,
 * returning the output bytes. The temp directory is always removed in `finally` —
 * success, ffmpeg failure, and timeout included — so no partial files leak.
 */
export const convertToWebm = async ({
  config,
  data,
  inputPath,
  originalName,
}: ConvertToWebmOptions): Promise<Buffer> => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payload-video-webm-'))

  try {
    let sourcePath = inputPath
    if (!sourcePath) {
      sourcePath = path.join(tmpDir, tempInputName(originalName))
      await fs.writeFile(sourcePath, data)
    }

    const outputPath = path.join(tmpDir, 'output.webm')
    const args = buildFfmpegArgs({
      encoding: config.encoding,
      inputPath: sourcePath,
      outputPath,
    })

    await runFfmpeg(config.ffmpegPath, args, config.timeoutMs)

    return await fs.readFile(outputPath)
  } finally {
    await fs.rm(tmpDir, { force: true, recursive: true })
  }
}

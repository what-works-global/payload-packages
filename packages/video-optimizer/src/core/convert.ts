import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ResolvedVideoOptimizerConfig, VideoCodec } from '../types.js'
import type { FocalPoint } from './args.js'

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
          `could not spawn ffmpeg at "${ffmpegPath}" — is it installed and on PATH, or set via the ffmpeg.path option / FFMPEG_PATH? (${error.message})`,
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

/** Bound on the dimension probe — it decodes nothing, so seconds are generous. */
const PROBE_TIMEOUT_MS = 30_000

export interface VideoDimensions {
  /** Display height in pixels, with any rotation metadata already applied. */
  height: number
  width: number
}

/**
 * Reads a video's display dimensions from `ffmpeg -i` (which prints the stream
 * table to stderr and exits non-zero because no output file was given) — one cheap
 * spawn, no ffprobe dependency. Resolves `null` whenever anything is unexpected:
 * callers must treat unknown dimensions as "encode everything".
 */
export const probeVideoDimensions = (
  ffmpegPath: string,
  inputPath: string,
): Promise<null | VideoDimensions> =>
  new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      child.stderr.destroy()
      resolve(null)
    }, PROBE_TIMEOUT_MS)

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_BYTES)
    })

    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parseDimensions(stderr))
    })
  })

/**
 * Pulls `WxH` off the first video stream line. A quarter-turn `displaymatrix`
 * rotation means the coded dimensions are transposed on screen, so they are
 * swapped back — otherwise a portrait phone clip reads as landscape and the
 * redundancy check would drop renditions that are real downscales.
 */
const parseDimensions = (stderr: string): null | VideoDimensions => {
  const lines = stderr.split('\n')
  const index = lines.findIndex((line) => /:\s+Video:/.test(line))
  if (index === -1) {
    return null
  }
  const match = /\b(\d{2,5})x(\d{2,5})\b/.exec(lines[index] ?? '')
  if (!match) {
    return null
  }
  const width = Number(match[1])
  const height = Number(match[2])

  // Side data belonging to this stream is indented underneath it, before the next
  // "Stream #" line.
  const sideData = []
  for (const line of lines.slice(index + 1)) {
    if (/^\s*Stream #/.test(line)) {
      break
    }
    sideData.push(line)
  }
  const rotation = /rotation of (-?[\d.]+) degrees/.exec(sideData.join('\n'))
  const quarterTurned = rotation ? Math.abs(Number(rotation[1])) % 180 === 90 : false

  return quarterTurned ? { height: width, width: height } : { height, width }
}

export interface EncodeToFileOptions {
  config: Pick<ResolvedVideoOptimizerConfig, 'encoding' | 'ffmpegPath' | 'timeoutMs'>
  /** Focal point of the source document, honoured by `aspectRatio` crops. */
  focal?: FocalPoint
  inputPath: string
  outputPath: string
}

/**
 * The core transcode: file in, file out, nothing buffered in memory. The conversion
 * job works in these terms so a multi-gigabyte master never lands on the Node heap.
 */
export const encodeToFile = ({
  config,
  focal,
  inputPath,
  outputPath,
}: EncodeToFileOptions): Promise<void> =>
  runFfmpeg(
    config.ffmpegPath,
    buildFfmpegArgs({ encoding: config.encoding, focal, inputPath, outputPath }),
    config.timeoutMs,
  )

export interface ConvertToWebmOptions {
  config: Pick<ResolvedVideoOptimizerConfig, 'encoding' | 'ffmpegPath' | 'timeoutMs'>
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
export const tempInputName = (originalName: string): string => {
  const ext = path.extname(path.basename(originalName))
  const safeExt = /^\.[\w-]{1,16}$/.test(ext) ? ext : ''
  return `input${safeExt}`
}

/**
 * Buffer-in, buffer-out convenience wrapper around {@link encodeToFile}, working in
 * a fresh `os.tmpdir()` directory that is always removed in `finally` — success,
 * ffmpeg failure, and timeout included — so no partial files leak. The conversion
 * job uses `encodeToFile` directly to keep whole videos off the heap.
 */
export const convertToWebm = async ({
  config,
  data,
  inputPath,
  originalName,
}: ConvertToWebmOptions): Promise<Buffer> => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payload-video-optimizer-'))

  try {
    let sourcePath = inputPath
    if (!sourcePath) {
      sourcePath = path.join(tmpDir, tempInputName(originalName))
      await fs.writeFile(sourcePath, data)
    }

    const outputPath = path.join(tmpDir, 'output.webm')
    await encodeToFile({ config, inputPath: sourcePath, outputPath })

    return await fs.readFile(outputPath)
  } finally {
    await fs.rm(tmpDir, { force: true, recursive: true })
  }
}

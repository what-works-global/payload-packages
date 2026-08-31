import { path as ffprobePathRaw } from 'ffprobe-static'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ffmpeg-static's shipped .d.ts declares `export default` on a package with
// no "type": "module", which its actual CJS runtime (`module.exports = <string
// | null>`) doesn't match — an ESM default import resolves to the whole
// module namespace instead. `require` sidesteps the broken interop entirely.
const ffmpegPathRaw = createRequire(import.meta.url)('ffmpeg-static') as null | string

function requireBinaryPath(binaryPath: null | string, pkg: string): string {
  if (!binaryPath) {
    throw new Error(`[video-pipeline] ${pkg} resolved no binary for this platform`)
  }
  return binaryPath
}

function run(binary: string, args: string[]): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve({ stderr, stdout })
        : reject(new Error(`${path.basename(binary)} exited ${code}: ${stderr.slice(-2000)}`)),
    )
  })
}

export async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'video-pipeline-'))
}

export interface SourceProbe {
  durationSeconds: number
  height: number
  width: number
}

export async function probeSource(filePath: string): Promise<SourceProbe> {
  const bin = requireBinaryPath(ffprobePathRaw, 'ffprobe-static')
  const { stdout } = await run(bin, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath,
  ])
  const parsed = JSON.parse(stdout)
  const stream = parsed.streams?.[0] ?? {}
  return {
    durationSeconds: Number(parsed.format?.duration) || 0,
    height: Number(stream.height) || 0,
    width: Number(stream.width) || 0,
  }
}

export interface TranscodeArgs {
  audioBitrateKbps: number
  cpuUsed: number
  crf?: number
  format: 'mp4' | 'webm'
  inputPath: string
  outputPath: string
  targetHeight: number
  videoBitrateKbps?: number
}

export async function transcode(args: TranscodeArgs): Promise<void> {
  const bin = requireBinaryPath(ffmpegPathRaw, 'ffmpeg-static')
  const {
    audioBitrateKbps,
    cpuUsed,
    crf = 32,
    format,
    inputPath,
    outputPath,
    targetHeight,
    videoBitrateKbps,
  } = args
  const common = ['-y', '-i', inputPath, '-vf', `scale=-2:${targetHeight}`]
  const codec =
    format === 'webm'
      ? [
          '-c:v',
          'libvpx-vp9',
          '-cpu-used',
          String(cpuUsed),
          '-row-mt',
          '1',
          ...(videoBitrateKbps
            ? ['-b:v', `${videoBitrateKbps}k`]
            : ['-crf', String(crf), '-b:v', '0']),
          '-c:a',
          'libopus',
          '-b:a',
          `${audioBitrateKbps}k`,
        ]
      : [
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          ...(videoBitrateKbps ? ['-b:v', `${videoBitrateKbps}k`] : ['-crf', String(crf)]),
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          `${audioBitrateKbps}k`,
          '-movflags',
          '+faststart',
        ]
  await run(bin, [...common, ...codec, outputPath])
}

export async function writeBufferToFile(buffer: Buffer, filePath: string): Promise<void> {
  await writeFile(filePath, buffer)
}

export async function readFileToBuffer(filePath: string): Promise<Buffer> {
  return readFile(filePath)
}

export async function cleanupScratchDir(dirPath: string): Promise<void> {
  await rm(dirPath, { force: true, recursive: true })
}

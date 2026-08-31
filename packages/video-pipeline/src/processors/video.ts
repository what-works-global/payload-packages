import path from 'node:path'

import type { VideoSizeConfig } from '../types.js'

import {
  cleanupScratchDir,
  createScratchDir,
  probeSource,
  readFileToBuffer,
  transcode,
  writeBufferToFile,
} from '../utils/ffmpegRunner.js'

export interface ProcessedSizeResult {
  buffer: Buffer
  filesize: number
  height: number
  width: number
}

export async function processVideoSize(
  sourceBuffer: Buffer,
  sourceExt: string,
  size: VideoSizeConfig,
): Promise<ProcessedSizeResult> {
  const scratchDir = await createScratchDir()
  try {
    const inputPath = path.join(scratchDir, `source${sourceExt || '.mp4'}`)
    const outputPath = path.join(scratchDir, `${size.slug}.${size.format}`)
    await writeBufferToFile(sourceBuffer, inputPath)

    const source = await probeSource(inputPath)
    const targetHeight = Math.min(size.resolutionHeight, source.height || size.resolutionHeight) // never upscale

    await transcode({
      audioBitrateKbps: size.audioBitrateKbps,
      cpuUsed: size.cpuUsed,
      crf: size.crf,
      format: size.format,
      inputPath,
      outputPath,
      targetHeight,
      videoBitrateKbps: size.videoBitrateKbps,
    })

    const outputProbe = await probeSource(outputPath)
    const buffer = await readFileToBuffer(outputPath)
    return {
      buffer,
      filesize: buffer.byteLength,
      height: outputProbe.height,
      width: outputProbe.width,
    }
  } finally {
    await cleanupScratchDir(scratchDir)
  }
}

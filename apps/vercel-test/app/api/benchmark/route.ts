import config, { encodeOutcomes } from '@payload-config'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'
import { getPayload } from 'payload'

import ffmpegStatic from 'ffmpeg-static'

/**
 * `POST /api/benchmark` with a video as multipart `file` — encodes the default
 * ladder and reports what each rung actually cost on this machine.
 *
 * The point is the hardware, not the plugin: every timing in the project's planning
 * so far came from an Apple-silicon laptop scaled by a guessed architecture factor,
 * and that factor is the shakiest number in the argument for (or against) building
 * segmentation. Send the *same* source here and locally and the factor stops being
 * a guess.
 */
export const maxDuration = 800

const run = promisify(execFile)

const machine = async (): Promise<Record<string, unknown>> => {
  const cpus = os.cpus()
  let ffmpegVersion: null | string = null
  try {
    const { stdout } = await run(ffmpegStatic ?? 'ffmpeg', ['-version'])
    ffmpegVersion = stdout.split('\n')[0] ?? null
  } catch {
    // Reported as null rather than failing the run: the encode below is the real
    // check on whether ffmpeg works here.
  }
  return {
    arch: os.arch(),
    // What Vercel bills as vCPU is what libvpx's row-mt can actually use, so this is
    // the number the per-rung timings should be read against.
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ?? null,
    ffmpegVersion,
    platform: os.platform(),
    region: process.env.VERCEL_REGION ?? null,
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    vercelEnv: process.env.VERCEL_ENV ?? null,
  }
}

export const GET = async (): Promise<Response> => Response.json({ machine: await machine() })

export const POST = async (request: Request): Promise<Response> => {
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'POST a video as multipart form field "file"' }, { status: 400 })
  }

  const payload = await getPayload({ config })
  const data = Buffer.from(await file.arrayBuffer())

  const startedAt = Date.now()
  const doc = await payload.create({
    collection: 'media',
    data: {},
    file: {
      data,
      mimetype: file.type || 'video/mp4',
      name: file.name || 'upload.mp4',
      size: data.byteLength,
    },
  })
  const totalMs = Date.now() - startedAt

  const key = String(doc.id)
  const outcomes = encodeOutcomes.get(key) ?? []
  encodeOutcomes.delete(key)

  // `create` resolves with the document as it was written, which is before the
  // conversion's own final write — reading status off it always says "queued". And
  // on a database with transactions the run starts *after* the upload commits, so
  // even a re-read can land before the job finishes. Poll until it settles.
  type Settled = {
    videoConversion?: { encodeDurationMs?: number; skippedReason?: string; status?: string }
  }
  let settled = (await payload.findByID({ id: doc.id, collection: 'media', depth: 0 })) as Settled
  const deadline = Date.now() + 60_000
  while (settled.videoConversion?.status === 'queued' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    settled = (await payload.findByID({ id: doc.id, collection: 'media', depth: 0 })) as Settled
  }

  return Response.json({
    machine: await machine(),
    source: { bytes: data.byteLength, name: file.name },
    // Wall time for the whole request, which includes the upload write and the
    // sidecar writes — always more than the encodes add up to.
    totalMs,
    rungs: outcomes.map((outcome) => ({
      bytes: outcome.convertedFilesize,
      encodeMs: outcome.encodeDurationMs,
      error: outcome.error,
      preset: outcome.preset,
      skippedReason: outcome.skippedReason,
      stored: outcome.converted,
    })),
    document: {
      id: doc.id,
      // The plugin's own total, against which the per-rung numbers should sum.
      encodeDurationMs: settled.videoConversion?.encodeDurationMs ?? null,
      skippedReason: settled.videoConversion?.skippedReason ?? null,
      status: settled.videoConversion?.status ?? null,
    },
  })
}

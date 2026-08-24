import type { CollectionBeforeOperationHook } from 'payload'

import fs from 'node:fs/promises'

import type { Semaphore } from '../core/semaphore.js'
import type { ResolvedVideoWebmConfig } from '../types.js'

import { WEBM_MIME_TYPE } from '../core/defaults.js'
import { toWebmFilename } from '../core/shouldConvert.js'
import {
  attemptConversion,
  convertedOutcome,
  report,
  SKIP_CONTEXT_KEY,
} from './attemptConversion.js'

/** `req.context` key the conversion outcome is stashed under for the metadata stamp hook. */
export const VIDEO_WEBM_CONTEXT_KEY = 'videoWebm'

/**
 * Replace mode: converts an incoming video upload to WebM by swapping `req.file`
 * before Payload processes it. Because the swap happens ahead of `generateFileData`,
 * Payload derives filename, mimeType and filesize from the converted file and hands
 * it to whichever storage adapter the collection uses — no filesystem coupling, no
 * second write, and the original is not retained.
 *
 * The plugin appends this hook after any `beforeOperation` hooks the collection
 * already declares, so those still see the original upload; every later hook stage
 * (`beforeValidate`, `beforeChange`, …) sees the converted WebM.
 */
export const createConvertHook = (
  config: ResolvedVideoWebmConfig,
  limiter: null | Semaphore,
): CollectionBeforeOperationHook => {
  return async ({ collection, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') {
      return
    }
    if (req.context[SKIP_CONTEXT_KEY]) {
      return
    }

    const file = req.file
    if (!file) {
      return
    }

    const result = await attemptConversion({
      collectionSlug: collection.slug,
      config,
      file,
      limiter,
      req,
    })

    if (result.record) {
      req.context[VIDEO_WEBM_CONTEXT_KEY] = result.record
    }
    if (!result.converted) {
      return
    }

    const outcome = convertedOutcome(
      collection.slug,
      result.sourceFile,
      result.output,
      result.encodeDurationMs,
    )

    // Payload reads from tempFilePath (not `data`) when present, so keep both in sync.
    if (file.tempFilePath) {
      await fs.writeFile(file.tempFilePath, result.output)
    }
    file.data = result.output
    file.mimetype = WEBM_MIME_TYPE
    file.name = toWebmFilename(file.name)
    file.size = result.output.byteLength

    await report(config, req, outcome)
  }
}

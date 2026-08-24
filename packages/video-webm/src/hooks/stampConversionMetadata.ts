import type { CollectionBeforeChangeHook } from 'payload'

import type { ConversionRecord } from '../types.js'

import { emptyRecord, SKIP_CONTEXT_KEY } from './attemptConversion.js'
import { VIDEO_WEBM_CONTEXT_KEY } from './convertUploadedVideo.js'

export const METADATA_GROUP_NAME = 'videoWebm'

/**
 * Copies the conversion outcome stashed by the beforeOperation hook into the doc's
 * metadata group. Runs only when this very request carried a file, so re-saving a
 * doc without replacing its upload never clobbers the stored record — while
 * replacing a converted video with a non-video correctly clears it.
 */
export const createStampHook =
  (): CollectionBeforeChangeHook =>
  ({ data, req }) => {
    if (!req.file || req.context[SKIP_CONTEXT_KEY]) {
      return data
    }

    const record = (req.context[VIDEO_WEBM_CONTEXT_KEY] as ConversionRecord | undefined) ?? {
      ...emptyRecord,
    }

    return {
      ...data,
      [METADATA_GROUP_NAME]: record,
    }
  }

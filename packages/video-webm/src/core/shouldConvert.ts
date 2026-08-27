import type { ConversionDecision, ResolvedVideoWebmConfig, UploadedFile } from '../types.js'

import { WEBM_MIME_TYPE } from './defaults.js'

/** Matches a mime type against a pattern that may use a `*` subtype wildcard (`video/*`). */
export const mimeTypeMatches = (pattern: string, mimeType: string): boolean => {
  const normalized = mimeType.toLowerCase()
  const lowered = pattern.toLowerCase()
  if (lowered.endsWith('/*')) {
    return normalized.startsWith(lowered.slice(0, -1))
  }
  return normalized === lowered
}

export const shouldConvert = (
  file: Pick<UploadedFile, 'mimetype' | 'size'>,
  config: Pick<ResolvedVideoWebmConfig, 'inputMimeTypes' | 'maxInputFileSize'>,
): ConversionDecision => {
  // Guarded before the allowlist so a `video/*` custom list can't re-encode WebM.
  if (mimeTypeMatches(WEBM_MIME_TYPE, file.mimetype)) {
    return { convert: false, reason: 'already-webm' }
  }
  if (!config.inputMimeTypes.some((pattern) => mimeTypeMatches(pattern, file.mimetype))) {
    return { convert: false, reason: 'mime-not-matched' }
  }
  if (config.maxInputFileSize !== null && file.size > config.maxInputFileSize) {
    return { convert: false, reason: 'input-too-large' }
  }
  return { convert: true }
}

/**
 * Swaps the extension for `.webm` (appends when there is none), suffixing the
 * preset name so renditions of one source never collide — the default `webm`
 * preset keeps the plain name: `clip.mp4` → `clip.webm` / `clip-720p.webm`.
 */
export const toWebmFilename = (filename: string, preset?: string): string => {
  const dotIndex = filename.lastIndexOf('.')
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const suffix = preset && preset !== 'webm' ? `-${preset}` : ''
  return `${base}${suffix}.webm`
}

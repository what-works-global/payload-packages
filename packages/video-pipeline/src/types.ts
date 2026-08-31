export type VideoOutputFormat = 'mp4' | 'webm'

export interface VideoSizeConfig {
  audioBitrateKbps: number
  /** Omit only on the one size that acts as the base/fallback variant. */
  breakpointMinWidth?: number
  cpuUsed: number
  crf?: number
  format: VideoOutputFormat
  label: string
  resolutionHeight: number
  slug: string
  videoBitrateKbps?: number
}

export type DerivativeStatus = 'done' | 'error' | 'pending' | 'processing'

/**
 * Embedded on the media doc — snapshot of the config a derivative was
 * generated under, plus a relationship to the actual file doc. Storing the
 * comparison fields here (not just a relationship) means staleness checks
 * never need an extra query.
 */
export interface VideoDerivativeEntry {
  audioBitrateKbps?: number
  breakpointMinWidth?: null | number
  cpuUsed?: number
  crf?: null | number
  derivative?: null | string
  error?: null | string
  format?: VideoOutputFormat
  generatedAt?: string
  label?: string
  resolutionHeight?: number
  sizeSlug: string
  status: DerivativeStatus
  videoBitrateKbps?: null | number
}

export interface VideoPipelinePluginOptions {
  backfillTaskSlug?: string
  collections: string[]
  cronSecretEnvVar?: string
  defaultVideoSizes?: VideoSizeConfig[]
  derivativesCollectionSlug?: string
  settingsGlobalSlug?: string
  taskSlug?: string
}

export interface ResolvedVideoPipelineOptions
  extends Required<Omit<VideoPipelinePluginOptions, 'defaultVideoSizes'>> {
  defaultVideoSizes: VideoSizeConfig[]
}

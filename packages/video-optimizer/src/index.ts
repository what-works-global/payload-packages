export {
  DEFAULT_INPUT_MIME_TYPES,
  DEFAULT_QUEUE,
  DEFAULT_TASK_SLUG,
  DEFAULT_WIDTH_LADDER,
  resolutionPresets,
  widthPresets,
} from './core/defaults.js'
export { METADATA_GROUP_NAME } from './fields/conversionMetadataField.js'
export {
  EXCLUDE_VIDEO_DERIVATIVES,
  RENDITION_GENERATION_FIELD_NAME,
  RENDITION_PRESET_FIELD_NAME,
  RENDITIONS_FIELD_NAME,
  VIDEO_DERIVATIVE_FLAG_FIELD_NAME,
} from './fields/sidecarFields.js'
export { VIDEO_PANEL_COMPONENT_PATH, videoOptimizerPlugin } from './plugin.js'

export type * from './types.js'

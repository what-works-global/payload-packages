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
  EXCLUDE_WEBM_DERIVATIVES,
  WEBM_DERIVATIVE_FLAG_FIELD_NAME,
  WEBM_GENERATION_FIELD_NAME,
  WEBM_PRESET_FIELD_NAME,
  WEBM_VERSIONS_FIELD_NAME,
} from './fields/sidecarFields.js'
export { videoWebmPlugin, WEBM_PANEL_COMPONENT_PATH } from './plugin.js'

export type * from './types.js'

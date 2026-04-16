import type { Plugin } from 'payload'

import type { BlockSettingsPluginOptions } from './types.js'

export const blockSettingsPlugin = (
  _options: BlockSettingsPluginOptions = {},
): Plugin => {
  return (config) => {
    return config
  }
}

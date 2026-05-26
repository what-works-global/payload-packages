import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { blockSettingsField, blockSettingsPlugin } from '../src/index.js'

const baseConfig: Partial<Config> = {
  collections: [],
  endpoints: [],
  globals: [],
}

describe('@whatworks/payload-block-settings peer smoke', () => {
  it('blockSettingsPlugin() returns a callable plugin', () => {
    const plugin = blockSettingsPlugin()
    expect(typeof plugin).toBe('function')
  })

  it('blockSettingsField() returns a field-shaped object', () => {
    const field = blockSettingsField({
      fields: [{ name: 'theme', type: 'text' }],
    })
    expect(field).toBeDefined()
    expect(typeof field).toBe('object')
  })

  it('plugin composes onto a minimal Payload config', async () => {
    const plugin = blockSettingsPlugin()
    const result = await plugin(baseConfig as Config)
    expect(result).toBeDefined()
  })
})

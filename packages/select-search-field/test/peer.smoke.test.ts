import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import {
  selectSearchEndpoint,
  selectSearchEndpointHandler,
  selectSearchField,
  selectSearchPlugin,
} from '../src/index.js'

const baseConfig: Partial<Config> = {
  collections: [],
  endpoints: [],
  globals: [],
}

describe('@whatworks/payload-select-search-field peer smoke', () => {
  it('endpoint name constant is exported', () => {
    expect(typeof selectSearchEndpoint).toBe('string')
    expect(selectSearchEndpoint.length).toBeGreaterThan(0)
  })

  it('endpoint handler factory returns an Endpoint', () => {
    const handler = selectSearchEndpointHandler()
    expect(handler).toBeDefined()
    expect(typeof handler).toBe('object')
  })

  it('selectSearchField() returns a field-shaped object', () => {
    const field = selectSearchField({
      name: 'fruits',
      label: 'Fruits',
      search: {
        searchFunction: () => [],
      },
    })
    expect(field).toBeDefined()
  })

  it('plugin composes onto a minimal Payload config', async () => {
    const plugin = selectSearchPlugin()
    const result = await plugin(baseConfig as Config)
    expect(result).toBeDefined()
    expect(Array.isArray(result.endpoints)).toBe(true)
  })
})

import type { Config, DatabaseAdapterObj } from 'payload'

import { describe, expect, it } from 'vitest'

import { switchEnvPlugin } from '../src/index.js'

const baseConfig: Partial<Config> = {
  collections: [],
  endpoints: [],
  globals: [],
}

const stubDatabaseAdapter = (): DatabaseAdapterObj =>
  ({
    defaultIDType: 'text',
    init: () => ({}) as never,
  }) as unknown as DatabaseAdapterObj

describe('@whatworks/payload-switch-env peer smoke', () => {
  it('switchEnvPlugin() returns a callable plugin', () => {
    const plugin = switchEnvPlugin({
      db: {
        developmentArgs: { url: 'http://localhost' },
        function: stubDatabaseAdapter,
        productionArgs: { url: 'http://localhost' },
      },
      payloadVersion: '3.54.0',
    })
    expect(typeof plugin).toBe('function')
  })

  it('plugin composes onto a minimal Payload config', async () => {
    const plugin = switchEnvPlugin({
      db: {
        developmentArgs: { url: 'http://localhost' },
        function: stubDatabaseAdapter,
        productionArgs: { url: 'http://localhost' },
      },
      payloadVersion: '3.54.0',
    })
    const result = await plugin(baseConfig as Config)
    expect(result).toBeDefined()
    expect(Array.isArray(result.endpoints)).toBe(true)
  })
})

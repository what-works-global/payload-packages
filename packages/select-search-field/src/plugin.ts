import type { Plugin } from 'payload'

import { selectSearchEndpointHandler } from './endpoint.js'

export const selectSearchPlugin = (): Plugin => {
  return (config) => {
    config.endpoints = [...(config.endpoints || []), selectSearchEndpointHandler()]
    return config
  }
}

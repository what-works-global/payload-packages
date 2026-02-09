import type { Plugin } from 'payload'
import { searchSelectEndpointHandler } from './endpoint.js'

export const searchSelectPlugin = (): Plugin => {
  return async (config) => {
    config.endpoints = [...(config.endpoints || []), searchSelectEndpointHandler()]
    return config
  }
}

import type { Config, Plugin } from 'payload'

import type { RedirectsPluginConfig } from './types.js'

import { buildRedirectsCollection } from './core/collection.js'
import { resolveRedirectsConfig } from './core/resolved.js'
import {
  createRedirectsAfterChangeHook,
  createRedirectsAfterDeleteHook,
  createRedirectsBeforeChangeHook,
  createTargetAfterChangeHook,
  createTargetAfterDeleteHook,
} from './core/resync.js'
import { createRedirectsEndpoints } from './endpoints/createEndpoints.js'

export const redirectsPlugin =
  (pluginConfig: RedirectsPluginConfig): Plugin =>
  (config: Config): Config => {
    const resolved = resolveRedirectsConfig(pluginConfig)

    if (resolved.localized && !config.localization) {
      // eslint-disable-next-line no-console
      console.warn(
        '[payload-redirects] `localized: true` requires `localization` on the Payload config — falling back to non-localized behavior.',
      )
      resolved.localized = false
    }

    if (config.collections?.some((collection) => collection.slug === resolved.slug)) {
      throw new Error(
        `[payload-redirects] A collection with the slug "${resolved.slug}" already exists on this config.`,
      )
    }

    let redirectsCollection = buildRedirectsCollection(resolved)
    if (pluginConfig.overrides) {
      redirectsCollection = pluginConfig.overrides({ collection: redirectsCollection })
    }

    /**
     * The collection is registered even when the plugin is disabled so the
     * database schema stays consistent for migrations; hooks, endpoints, and
     * cache syncing stay off.
     */
    config.collections = [...(config.collections ?? []), redirectsCollection]

    if (pluginConfig.disabled) {
      return config
    }

    config.custom = { ...config.custom, redirects: resolved }

    const targetSlugs = Object.keys(resolved.collections)
    for (const slug of targetSlugs) {
      if (!config.collections.some((collection) => collection.slug === slug)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[payload-redirects] Collection "${slug}" is configured as a redirect destination but does not exist.`,
        )
      }
    }

    config.collections = config.collections.map((collection) => {
      const isRedirects = collection.slug === resolved.slug
      const isTarget = targetSlugs.includes(collection.slug)
      if (!isRedirects && !isTarget) {
        return collection
      }

      return {
        ...collection,
        hooks: {
          ...collection.hooks,
          afterChange: [
            ...(collection.hooks?.afterChange ?? []),
            isRedirects
              ? createRedirectsAfterChangeHook()
              : createTargetAfterChangeHook(collection.slug),
          ],
          afterDelete: [
            ...(collection.hooks?.afterDelete ?? []),
            isRedirects
              ? createRedirectsAfterDeleteHook()
              : createTargetAfterDeleteHook(collection.slug),
          ],
          ...(isRedirects
            ? {
                beforeChange: [
                  ...(collection.hooks?.beforeChange ?? []),
                  createRedirectsBeforeChangeHook(),
                ],
              }
            : {}),
        },
      }
    })

    config.endpoints = [...(config.endpoints ?? []), ...createRedirectsEndpoints(resolved)]

    return config
  }

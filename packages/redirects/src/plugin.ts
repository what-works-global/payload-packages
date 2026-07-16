import type { Config, Plugin } from 'payload'

import type { RedirectsPluginConfig } from './types.js'

import { syncRedirectsCache } from './core/build.js'
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

    /**
     * Compose `onInit`: run any prior `onInit` first, warn (in production) when
     * the endpoints are left open, then prime the cache from the database so a
     * freshly booted instance serves redirects without waiting for the first
     * content change or cache-miss refresh. Neither step may crash boot. Skipped
     * entirely when the plugin is `disabled` (handled by the early return above).
     */
    const priorOnInit = config.onInit
    config.onInit = async (payload) => {
      if (priorOnInit) {
        await priorOnInit(payload)
      }

      // An unset `secret` leaves the `refresh-cache` and `hit/:id` endpoints
      // publicly reachable — warn once on boot, even when `syncOnInit` is false.
      if (process.env.NODE_ENV === 'production' && !resolved.secret) {
        payload.logger.warn(
          '[payload-redirects] Running in production without a `secret`: the `refresh-cache` and `hit/:id` endpoints are publicly reachable. Set the `secret` plugin option (and pass the same value to the middleware/resolver) to require the `x-payload-redirects-secret` header or an authenticated user.',
        )
      }

      if (pluginConfig.syncOnInit !== false) {
        try {
          await syncRedirectsCache(payload)
        } catch (error) {
          payload.logger.error(
            error,
            '[payload-redirects] Failed to sync the redirects cache on init',
          )
        }
      }
    }

    return config
  }

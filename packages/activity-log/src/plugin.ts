import type { CollectionConfig, Config, GlobalConfig, Plugin } from 'payload'

import type { ActivityHookContext } from './hooks/createActivityEntry.js'
import type { ActivityLogCustomConfig } from './shared.js'
import type { ActivityEntitySelection, ActivityLogPluginConfig } from './types.js'

import { getActivityLogCollection } from './collections/getActivityLogCollection.js'
import {
  defaultCollectionSlug,
  defaultEvents,
  defaultResolveIpAddress,
  defaultSnapshotMode,
} from './defaults.js'
import { logAfterLogin, logAfterLogout } from './hooks/logAuthActivity.js'
import {
  logCollectionAfterChange,
  logCollectionAfterDelete,
} from './hooks/logCollectionActivity.js'
import { logGlobalAfterChange } from './hooks/logGlobalActivity.js'
import { pluginKey } from './shared.js'

const createSelector = <TSlug extends string>(
  selection: ActivityEntitySelection<TSlug> | undefined,
): ((slug: string) => boolean) => {
  if (selection === undefined || selection === true) {
    return () => true
  }
  if (Array.isArray(selection)) {
    const included = new Set<string>(selection)
    return (slug) => included.has(slug)
  }
  const excluded = new Set<string>(selection.exclude)
  return (slug) => !excluded.has(slug)
}

const resolveUserCollections = (
  config: Config,
  pluginConfig: ActivityLogPluginConfig,
): string[] => {
  if (pluginConfig.userCollections?.length) {
    return pluginConfig.userCollections
  }
  const authSlugs = (config.collections ?? [])
    .filter((collection) => Boolean(collection.auth))
    .map((collection) => collection.slug)
  if (authSlugs.length) {
    return authSlugs
  }
  return [config.admin?.user ?? 'users']
}

export const activityLogPlugin = (pluginConfig: ActivityLogPluginConfig = {}): Plugin => {
  return (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }

    if (pluginConfig.enabled === false) {
      return config
    }

    const logSlug = pluginConfig.collectionSlug ?? defaultCollectionSlug

    if ((config.collections ?? []).some((collection) => collection.slug === logSlug)) {
      throw new Error(
        `activity-log: a collection with the slug "${logSlug}" already exists. ` +
          `Pass \`collectionSlug\` to store log entries under a different slug.`,
      )
    }

    const events = { ...defaultEvents, ...pluginConfig.events }
    const snapshot = pluginConfig.snapshot ?? defaultSnapshotMode
    const retention = pluginConfig.retention ?? null
    const userCollections = resolveUserCollections(config, pluginConfig)
    const shouldLogCollection = createSelector(pluginConfig.collections)
    const shouldLogGlobal = createSelector(pluginConfig.globals)
    const resolveIpAddress =
      typeof pluginConfig.ipAddress === 'function'
        ? pluginConfig.ipAddress
        : pluginConfig.ipAddress
          ? defaultResolveIpAddress
          : null

    const context: ActivityHookContext = {
      events,
      logSlug,
      resolveDocumentLabel: pluginConfig.resolveDocumentLabel,
      resolveIpAddress,
      resolveUser: pluginConfig.resolveUser,
      resolveUserLabel: pluginConfig.resolveUserLabel,
      retention,
      snapshot,
    }

    const loggedCollection = (collection: CollectionConfig): CollectionConfig => {
      let result = collection

      if (
        shouldLogCollection(collection.slug) &&
        (events.create || events.update || events.delete)
      ) {
        result = {
          ...result,
          hooks: {
            ...result.hooks,
            afterChange: [...(result.hooks?.afterChange ?? []), logCollectionAfterChange(context)],
            afterDelete: [...(result.hooks?.afterDelete ?? []), logCollectionAfterDelete(context)],
          },
        }
      }

      if (Boolean(collection.auth) && userCollections.includes(collection.slug)) {
        if (events.login) {
          result = {
            ...result,
            hooks: {
              ...result.hooks,
              afterLogin: [...(result.hooks?.afterLogin ?? []), logAfterLogin(context)],
            },
          }
        }
        if (events.logout) {
          result = {
            ...result,
            hooks: {
              ...result.hooks,
              afterLogout: [...(result.hooks?.afterLogout ?? []), logAfterLogout(context)],
            },
          }
        }
      }

      return result
    }

    const loggedGlobal = (global: GlobalConfig): GlobalConfig => {
      if (!events.create && !events.update) {
        return global
      }
      return {
        ...global,
        hooks: {
          ...global.hooks,
          afterChange: [...(global.hooks?.afterChange ?? []), logGlobalAfterChange(context)],
        },
      }
    }

    config.collections = (config.collections ?? []).map(loggedCollection)

    config.globals = (config.globals ?? []).map((global) =>
      shouldLogGlobal(global.slug) ? loggedGlobal(global) : global,
    )

    let logCollection = getActivityLogCollection({
      slug: logSlug,
      ipAddress: resolveIpAddress !== null,
      userCollections,
    })
    if (pluginConfig.collectionOverride) {
      logCollection = pluginConfig.collectionOverride(logCollection)
    }
    config.collections = [...config.collections, logCollection]

    const customConfig: ActivityLogCustomConfig = {
      collectionSlug: logSlug,
      events,
      ipAddress: resolveIpAddress !== null,
      resolveUserLabel: pluginConfig.resolveUserLabel ?? null,
      retention,
      snapshot,
      userCollections,
    }

    config.custom = {
      ...config.custom,
      [pluginKey]: customConfig,
    }

    return config
  }
}

import type { CollectionConfig, Config, GlobalConfig, Plugin } from 'payload'

import type { ActivityHookContext } from './hooks/createActivityEntry.js'
import type { ActivityLogCustomConfig } from './shared.js'
import type {
  ActivityEntitySelection,
  ActivityLogPluginConfig,
  SnapshotScopeConfig,
} from './types.js'

import { getActivityLogCollection } from './collections/getActivityLogCollection.js'
import {
  defaultCollectionSlug,
  defaultCollectionSnapshotMode,
  defaultEvents,
  defaultGlobalSnapshotMode,
  defaultResolveIpAddress,
  defaultResolveRequestHost,
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

/**
 * Builds a per-slug resolver from a scope's snapshot config: a bare mode applies to
 * every entity; the object form supplies a `default` (falling back to the scope's
 * built-in default) plus per-slug `overrides`.
 */
const createSnapshotResolver = <TMode extends string, TSlug extends string>(
  scope: SnapshotScopeConfig<TMode, TSlug> | undefined,
  fallbackMode: TMode,
): ((slug: string) => TMode) => {
  if (scope === undefined) {
    return () => fallbackMode
  }
  if (typeof scope === 'string') {
    return () => scope
  }
  const base = scope.default ?? fallbackMode
  const overrides = (scope.overrides ?? {}) as Partial<Record<string, TMode>>
  return (slug) => overrides[slug] ?? base
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
    const resolveCollectionSnapshot = createSnapshotResolver(
      pluginConfig.snapshot?.collections,
      defaultCollectionSnapshotMode,
    )
    const resolveGlobalSnapshot = createSnapshotResolver(
      pluginConfig.snapshot?.globals,
      defaultGlobalSnapshotMode,
    )
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
    const resolveRequestHost =
      typeof pluginConfig.requestHost === 'function'
        ? pluginConfig.requestHost
        : pluginConfig.requestHost
          ? defaultResolveRequestHost
          : null

    const context: ActivityHookContext = {
      events,
      logSlug,
      resolveDocumentLabel: pluginConfig.resolveDocumentLabel,
      resolveIpAddress,
      resolveRequestHost,
      resolveUser: pluginConfig.resolveUser,
      resolveUserLabel: pluginConfig.resolveUserLabel,
      retention,
      snapshot: {
        collection: resolveCollectionSnapshot,
        global: resolveGlobalSnapshot,
      },
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
      requestHost: resolveRequestHost !== null,
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
      requestHost: resolveRequestHost !== null,
      resolveUserLabel: pluginConfig.resolveUserLabel ?? null,
      retention,
      snapshot: {
        collections: pluginConfig.snapshot?.collections ?? defaultCollectionSnapshotMode,
        globals: pluginConfig.snapshot?.globals ?? defaultGlobalSnapshotMode,
      },
      userCollections,
    }

    config.custom = {
      ...config.custom,
      [pluginKey]: customConfig,
    }

    return config
  }
}

import type { CollectionConfig, Config, Plugin } from 'payload'

import type {
  AlgoliaIndexSettings,
  AlgoliaSearchContext,
  AlgoliaSearchPluginConfig,
  CollectionSearchOptions,
} from './types.js'

import { createAlgoliaClientFactory } from './algolia.js'
import {
  defaultContentLimit,
  defaultExcludeFields,
  defaultIndexSettings,
  defaultReindexAccess,
  defaultReindexBatchSize,
  defaultReindexPath,
} from './defaults.js'
import { syncAfterChange, syncAfterDelete } from './hooks.js'
import { createReindexHandler } from './reindex.js'
import { createRichTextToText, loadLexicalConverter } from './richText.js'
import { pluginKey, reindexActionPath } from './shared.js'

const mergeIndexSettings = (overrides: AlgoliaIndexSettings | undefined): AlgoliaIndexSettings => {
  const merged: AlgoliaIndexSettings = { ...defaultIndexSettings, ...overrides }
  // per-collection reindexes delete by the `collection` facet — keep it
  // filterable no matter what the override says
  const faceting = merged.attributesForFaceting ?? []
  if (!faceting.includes('filterOnly(collection)') && !faceting.includes('collection')) {
    merged.attributesForFaceting = [...faceting, 'filterOnly(collection)']
  }
  return merged
}

export const algoliaSearchPlugin =
  (pluginConfig: AlgoliaSearchPluginConfig): Plugin =>
  (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }

    if (pluginConfig.enabled === false) {
      return config
    }

    const { algolia } = pluginConfig
    const configured = Boolean(algolia?.appId && algolia?.apiKey && algolia?.index)
    if (!configured) {
      // eslint-disable-next-line no-console
      console.warn(
        '[algolia-search] missing algolia.appId / apiKey / index — search sync is paused until credentials are provided',
      )
    }

    const collections: Record<string, CollectionSearchOptions> = {}
    for (const [slug, value] of Object.entries(pluginConfig.collections ?? {})) {
      if (!value) {
        continue
      }
      // per-slug doc typing is erased at this boundary; the runtime shape is identical
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- no-op here (CollectionSlug = string), required when generated types narrow it
      collections[slug] = value === true ? {} : (value as CollectionSearchOptions)
    }

    const knownSlugs = new Set((config.collections ?? []).map((collection) => collection.slug))
    for (const slug of Object.keys(collections)) {
      if (!knownSlugs.has(slug)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[algolia-search] collection "${slug}" is configured for search but does not exist`,
        )
      }
    }

    const reindexConfig = typeof pluginConfig.reindex === 'object' ? pluginConfig.reindex : {}
    const endpointEnabled = pluginConfig.reindex !== false
    const actionEnabled = endpointEnabled && reindexConfig.button !== false

    const context: AlgoliaSearchContext = {
      awaitSync: pluginConfig.awaitSync !== false,
      collections,
      configured,
      contentLimit: pluginConfig.contentLimit ?? defaultContentLimit,
      excludeFields: pluginConfig.excludeFields ?? defaultExcludeFields,
      getClient: createAlgoliaClientFactory(algolia),
      getPath: pluginConfig.getPath,
      indexName: algolia?.index ?? '',
      indexSettings:
        pluginConfig.indexSettings === false
          ? false
          : mergeIndexSettings(pluginConfig.indexSettings),
      reindex: {
        access: reindexConfig.access ?? defaultReindexAccess,
        batchSize: reindexConfig.batchSize ?? defaultReindexBatchSize,
        depth: reindexConfig.depth ?? 0,
        endpointEnabled,
        path: reindexConfig.path ?? defaultReindexPath,
      },
      richTextToText:
        pluginConfig.richTextToText ?? createRichTextToText(pluginConfig.richTextConverters),
      waitUntil: pluginConfig.waitUntil,
    }

    if (!pluginConfig.richTextToText) {
      // warm the optional Lexical plaintext converter; harmless if absent
      void loadLexicalConverter()
    }

    const withSearch = (collection: CollectionConfig): CollectionConfig => {
      if (!collections[collection.slug]) {
        return collection
      }

      return {
        ...collection,
        hooks: {
          ...collection.hooks,
          afterChange: [...(collection.hooks?.afterChange ?? []), syncAfterChange(context)],
          afterDelete: [...(collection.hooks?.afterDelete ?? []), syncAfterDelete(context)],
        },
      }
    }

    config.collections = (config.collections ?? []).map(withSearch)

    if (endpointEnabled) {
      config.endpoints = [
        ...(config.endpoints ?? []),
        {
          handler: createReindexHandler(context),
          method: 'post',
          path: context.reindex.path,
        },
      ]
    }

    if (actionEnabled) {
      config.admin = {
        ...config.admin,
        components: {
          ...config.admin?.components,
          actions: [
            ...(config.admin?.components?.actions ?? []),
            {
              clientProps: {
                collections: Object.keys(collections),
                reindexPath: context.reindex.path,
              },
              path: reindexActionPath,
            },
          ],
        },
      }
    }

    config.custom = {
      ...config.custom,
      [pluginKey]: context,
    }

    return config
  }

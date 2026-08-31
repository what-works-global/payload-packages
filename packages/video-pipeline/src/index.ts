import type { Config } from 'payload'

import type { ResolvedVideoPipelineOptions, VideoPipelinePluginOptions } from './types.js'

import { buildVideoDerivativesCollection } from './collections/videoDerivatives.js'
import { buildBackfillEndpoint } from './endpoints/backfill.js'
import { buildRegenerateEndpoint } from './endpoints/regenerate.js'
import { buildDerivativesField, regenerateButtonField } from './fields/derivativesField.js'
import { buildVideoPipelineSettingsGlobal } from './globals/videoPipelineSettings.js'
import { buildQueueOnUploadHook } from './hooks/queueOnUpload.js'
import { buildBackfillHandler } from './tasks/backfillVideoSizes.js'
import { buildProcessVideoAssetHandler } from './tasks/processVideoAsset.js'

function resolveOptions(userOptions: VideoPipelinePluginOptions): ResolvedVideoPipelineOptions {
  if (!userOptions.collections?.length) {
    throw new Error('[video-pipeline] `collections` is required')
  }
  return {
    backfillTaskSlug: userOptions.backfillTaskSlug ?? 'backfillVideoSizes',
    collections: userOptions.collections,
    cronSecretEnvVar: userOptions.cronSecretEnvVar ?? 'CRON_SECRET',
    defaultVideoSizes: userOptions.defaultVideoSizes ?? [],
    derivativesCollectionSlug: userOptions.derivativesCollectionSlug ?? 'video-derivatives',
    settingsGlobalSlug: userOptions.settingsGlobalSlug ?? 'video-pipeline-settings',
    taskSlug: userOptions.taskSlug ?? 'transcodeVideo',
  }
}

export function videoPipelinePlugin(userOptions: VideoPipelinePluginOptions) {
  const options = resolveOptions(userOptions)

  return (incoming: Config): Config => {
    const config = { ...incoming }

    config.globals = [...(config.globals ?? []), buildVideoPipelineSettingsGlobal(options)]

    config.collections = [
      ...(config.collections ?? []),
      buildVideoDerivativesCollection(options),
    ].map((collection) => {
      if (!options.collections.includes(collection.slug)) {
        return collection
      }
      return {
        ...collection,
        endpoints: [
          ...(collection.endpoints === false ? [] : (collection.endpoints ?? [])),
          buildRegenerateEndpoint(collection.slug, options),
        ],
        fields: [...collection.fields, buildDerivativesField(options), regenerateButtonField],
        hooks: {
          ...collection.hooks,
          afterChange: [
            ...(collection.hooks?.afterChange ?? []),
            buildQueueOnUploadHook(collection.slug, options),
          ],
        },
      }
    })

    config.endpoints = [...(config.endpoints ?? []), buildBackfillEndpoint(options)]

    config.jobs = {
      ...config.jobs,
      access: {
        ...config.jobs?.access,
        run: ({ req }) => {
          const auth = req.headers.get('authorization')
          const secret = process.env[options.cronSecretEnvVar]
          if (secret && auth === `Bearer ${secret}`) {
            return true
          }
          return Boolean(req.user)
        },
      },
      tasks: [
        ...(config.jobs?.tasks ?? []),
        {
          slug: options.taskSlug,
          handler: buildProcessVideoAssetHandler(options),
          inputSchema: [
            { name: 'collection', type: 'text', required: true },
            { name: 'mediaId', type: 'text', required: true },
          ],
          retries: 2,
        },
        {
          slug: options.backfillTaskSlug,
          handler: buildBackfillHandler(options),
          inputSchema: [{ name: 'collection', type: 'text', required: true }],
          retries: 1,
        },
      ],
    }

    return config
  }
}

export default videoPipelinePlugin
export type {
  DerivativeStatus,
  ResolvedVideoPipelineOptions,
  VideoDerivativeEntry,
  VideoPipelinePluginOptions,
  VideoSizeConfig,
} from './types.js'

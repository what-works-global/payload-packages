import type { BaseListFilter, CollectionConfig, Config, Where } from 'payload'

import type { ConvertTaskRegistryEntry } from './jobs/convertTask.js'
import type { VideoCodec, VideoWebmCollectionOverrides, VideoWebmPluginConfig } from './types.js'

import { checkFfmpeg, requiredEncodersFor } from './core/convert.js'
import {
  DEFAULT_QUEUE,
  DEFAULT_RETRIES,
  DEFAULT_TASK_SLUG,
  mergeCollectionOverrides,
  resolveConfig,
  WEBM_MIME_TYPE,
} from './core/defaults.js'
import { Semaphore } from './core/semaphore.js'
import { mimeTypeMatches } from './core/shouldConvert.js'
import { conversionMetadataField, METADATA_GROUP_NAME } from './fields/conversionMetadataField.js'
import {
  WEBM_DERIVATIVE_FLAG_FIELD_NAME,
  WEBM_PRESET_FIELD_NAME,
  WEBM_VERSIONS_FIELD_NAME,
  webmDerivativeFlagField,
  webmPresetField,
  webmVersionsField,
} from './fields/sidecarFields.js'
import { createQueueHook, createStampHook } from './hooks/stampAndQueue.js'
import { createSidecarCleanupHook, createSidecarDeleteHook } from './hooks/webmSidecar.js'
import { createConvertTask } from './jobs/convertTask.js'

const isUploadCollection = (collection: CollectionConfig): boolean => Boolean(collection.upload)

/**
 * A collection restricting `upload.mimeTypes` would reject the sidecar's WebM file —
 * so `video/webm` is added whenever the restriction allows any of the convertible
 * inputs but not the output.
 */
const withWebmMimeType = (collection: CollectionConfig): CollectionConfig => {
  if (typeof collection.upload !== 'object' || !Array.isArray(collection.upload.mimeTypes)) {
    return collection
  }
  const { mimeTypes } = collection.upload
  if (mimeTypes.some((pattern) => mimeTypeMatches(pattern, WEBM_MIME_TYPE))) {
    return collection
  }
  return {
    ...collection,
    upload: {
      ...collection.upload,
      mimeTypes: [...mimeTypes, WEBM_MIME_TYPE],
    },
  }
}

const hasNamedField = (collection: CollectionConfig, name: string): boolean =>
  collection.fields.some((field) => 'name' in field && field.name === name)

const HIDE_DERIVATIVES: Where = { [WEBM_DERIVATIVE_FLAG_FIELD_NAME]: { not_equals: true } }

/** Keeps plugin-managed sidecars out of the admin list view, composing with any existing filter. */
const withDerivativeListFilter = (collection: CollectionConfig): CollectionConfig => {
  const existing = collection.admin?.baseListFilter
  const baseListFilter: BaseListFilter = existing
    ? async (args) => {
        const result = await existing(args)
        return result ? { and: [result, HIDE_DERIVATIVES] } : HIDE_DERIVATIVES
      }
    : () => HIDE_DERIVATIVES
  return {
    ...collection,
    admin: { ...collection.admin, baseListFilter },
  }
}

/** Normalizes both `collections` forms into slug → overrides; `null` means every upload collection. */
const normalizeTargets = (
  collections: VideoWebmPluginConfig['collections'],
): Map<string, true | VideoWebmCollectionOverrides> | null => {
  if (!collections) {
    return null
  }
  if (Array.isArray(collections)) {
    return new Map(collections.map((slug) => [slug, true]))
  }
  return new Map(Object.entries(collections))
}

// Deliberately narrower than Payload's `Plugin` type (which allows Promise<Config>):
// the plugin is synchronous, and the precise type keeps config-shaping tests await-free.
export const videoWebmPlugin =
  (pluginConfig: VideoWebmPluginConfig = {}) =>
  (incomingConfig: Config): Config => {
    if (pluginConfig.enabled === false) {
      return incomingConfig
    }

    const config = { ...incomingConfig }
    const collections = config.collections ?? []
    const targets = normalizeTargets(pluginConfig.collections)

    if (targets) {
      for (const slug of targets.keys()) {
        const collection = collections.find((candidate) => candidate.slug === slug)
        if (!collection) {
          throw new Error(`[payload-video-webm] collection "${slug}" does not exist`)
        }
        if (!isUploadCollection(collection)) {
          throw new Error(
            `[payload-video-webm] collection "${slug}" is not an upload collection — only upload collections can convert videos`,
          )
        }
      }
    }

    // Validates the plugin-level options up front (even with zero targets) and
    // supplies the resolved maxConcurrentEncodes default. One limiter per plugin
    // instance, shared across its collections, so the cap applies to this Node.js
    // process rather than to each collection.
    const pluginResolved = resolveConfig(pluginConfig)
    const limiter =
      pluginResolved.maxConcurrentEncodes === null
        ? null
        : new Semaphore(pluginResolved.maxConcurrentEncodes)

    const taskSlug = pluginConfig.taskSlug ?? DEFAULT_TASK_SLUG
    const queue = pluginConfig.queue ?? DEFAULT_QUEUE
    const dispatch = pluginConfig.dispatch ?? null
    const retries = pluginConfig.retries ?? DEFAULT_RETRIES

    /** Per-collection resolved configs the job handler looks up at run time. */
    const registry = new Map<string, ConvertTaskRegistryEntry>()

    config.collections = collections.map((collection) => {
      const overrides = targets ? targets.get(collection.slug) : isUploadCollection(collection)
      if (!overrides) {
        return collection
      }

      const resolved = resolveConfig(mergeCollectionOverrides(pluginConfig, overrides))
      registry.set(collection.slug, { config: resolved, limiter })

      const withMime = withWebmMimeType(collection)
      const fields = [
        ...withMime.fields,
        ...(resolved.metadataFields && !hasNamedField(withMime, METADATA_GROUP_NAME)
          ? [conversionMetadataField()]
          : []),
        ...(hasNamedField(withMime, WEBM_VERSIONS_FIELD_NAME)
          ? []
          : [webmVersionsField(withMime.slug)]),
        ...(hasNamedField(withMime, WEBM_DERIVATIVE_FLAG_FIELD_NAME)
          ? []
          : [webmDerivativeFlagField()]),
        ...(hasNamedField(withMime, WEBM_PRESET_FIELD_NAME) ? [] : [webmPresetField()]),
      ]

      // Plugin hooks are appended after the collection's own hooks, so user hooks
      // always run first and always see the untouched original upload — conversion
      // happens later, in the background job.
      return withDerivativeListFilter({
        ...withMime,
        fields,
        hooks: {
          ...withMime.hooks,
          afterChange: [
            ...(withMime.hooks?.afterChange ?? []),
            createSidecarCleanupHook(),
            createQueueHook({ dispatch, queue, taskSlug }),
          ],
          afterDelete: [...(withMime.hooks?.afterDelete ?? []), createSidecarDeleteHook()],
          beforeChange: [...(withMime.hooks?.beforeChange ?? []), createStampHook(resolved)],
        },
      })
    })

    if (registry.size > 0) {
      const existingTasks = config.jobs?.tasks ?? []
      if (existingTasks.some((task) => task.slug === taskSlug)) {
        throw new Error(
          `[payload-video-webm] a job task with slug "${taskSlug}" is already registered — running two plugin instances requires a distinct taskSlug per instance`,
        )
      }
      config.jobs = {
        ...config.jobs,
        tasks: [...existingTasks, createConvertTask(taskSlug, retries, registry)],
      }

      const ffmpegPath = pluginResolved.ffmpegPath
      const codecs = [
        ...new Set<VideoCodec>(
          [...registry.values()].flatMap((entry) =>
            Object.values(entry.config.presets).map((preset) => preset.encoding.codec),
          ),
        ),
      ]

      const incomingOnInit = config.onInit
      config.onInit = async (payload) => {
        // Surface a broken install at boot instead of on the first conversion job.
        // Note: only the process that runs jobs needs ffmpeg — a web app that only
        // queues can ignore this warning if a separate jobs runner carries ffmpeg.
        const check = await checkFfmpeg(ffmpegPath, requiredEncodersFor(codecs))
        if (!check.available) {
          payload.logger.warn(
            `[payload-video-webm] ffmpeg not found or not executable at "${ffmpegPath}" — conversion jobs will fail in this process until it is installed (or set ffmpegPath / FFMPEG_PATH)`,
          )
        } else if (check.missingEncoders.length > 0) {
          payload.logger.warn(
            `[payload-video-webm] ffmpeg at "${ffmpegPath}" is missing required encoders: ${check.missingEncoders.join(', ')} — conversions will fail until a build with libvpx/libopus is installed`,
          )
        }
        if (!dispatch) {
          payload.logger.warn(
            `[payload-video-webm] no dispatch configured — conversions run inline and the upload request waits for the encode. Pass dispatch (e.g. Next's after(run), waitUntil(run()), or void run()) to background them.`,
          )
        }
        await incomingOnInit?.(payload)
      }
    }

    return config
  }

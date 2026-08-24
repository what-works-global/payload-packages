import type { BaseListFilter, CollectionConfig, Config, Where } from 'payload'

import type {
  ResolvedVideoWebmConfig,
  VideoCodec,
  VideoWebmCollectionOverrides,
  VideoWebmPluginConfig,
} from './types.js'

import { checkFfmpeg, requiredEncodersFor } from './core/convert.js'
import { mergeCollectionOverrides, resolveConfig, WEBM_MIME_TYPE } from './core/defaults.js'
import { Semaphore } from './core/semaphore.js'
import { mimeTypeMatches } from './core/shouldConvert.js'
import { conversionMetadataField } from './fields/conversionMetadataField.js'
import { webmDerivativeFlagField, webmVersionField } from './fields/sidecarFields.js'
import { createConvertHook } from './hooks/convertUploadedVideo.js'
import { createStampHook, METADATA_GROUP_NAME } from './hooks/stampConversionMetadata.js'
import {
  createSidecarCleanupHook,
  createSidecarDeleteHook,
  createSidecarHook,
  WEBM_DERIVATIVE_FLAG_FIELD_NAME,
  WEBM_VERSION_FIELD_NAME,
} from './hooks/webmSidecar.js'

const isUploadCollection = (collection: CollectionConfig): boolean => Boolean(collection.upload)

/**
 * A collection restricting `upload.mimeTypes` would reject the converted file, since
 * mime validation runs after the hook swaps it — so `video/webm` is added whenever
 * the restriction allows any of the convertible inputs but not the output.
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

    const resolvedConfigs: ResolvedVideoWebmConfig[] = []

    config.collections = collections.map((collection) => {
      const overrides = targets ? targets.get(collection.slug) : isUploadCollection(collection)
      if (!overrides) {
        return collection
      }

      const resolved = resolveConfig(mergeCollectionOverrides(pluginConfig, overrides))
      resolvedConfigs.push(resolved)

      const withMime = withWebmMimeType(collection)
      const injectMetadata =
        resolved.metadataFields && !hasNamedField(withMime, METADATA_GROUP_NAME)
      const metadataFields = injectMetadata ? [conversionMetadataField()] : []

      if (resolved.keepOriginal) {
        // Sidecar mode: the original stays the document's file; the WebM becomes a
        // hidden second document in the same collection (same storage adapter) that
        // the sidecar hook creates and links, and the cleanup hooks garbage-collect.
        const sidecarFields = [
          ...(hasNamedField(withMime, WEBM_VERSION_FIELD_NAME)
            ? []
            : [webmVersionField(withMime.slug)]),
          ...(hasNamedField(withMime, WEBM_DERIVATIVE_FLAG_FIELD_NAME)
            ? []
            : [webmDerivativeFlagField()]),
        ]
        return withDerivativeListFilter({
          ...withMime,
          fields: [...withMime.fields, ...metadataFields, ...sidecarFields],
          hooks: {
            ...withMime.hooks,
            afterChange: [...(withMime.hooks?.afterChange ?? []), createSidecarCleanupHook()],
            afterDelete: [...(withMime.hooks?.afterDelete ?? []), createSidecarDeleteHook()],
            // Appended after the collection's own hooks, which therefore run before
            // the sidecar is created and see the untouched original upload.
            beforeChange: [
              ...(withMime.hooks?.beforeChange ?? []),
              createSidecarHook(resolved, limiter),
            ],
          },
        })
      }

      return {
        ...withMime,
        fields: [...withMime.fields, ...metadataFields],
        hooks: {
          ...withMime.hooks,
          beforeChange: injectMetadata
            ? [...(withMime.hooks?.beforeChange ?? []), createStampHook()]
            : withMime.hooks?.beforeChange,
          // Appended after the collection's own hooks: user beforeOperation hooks
          // observe the original upload; every later stage sees the converted WebM.
          beforeOperation: [
            ...(withMime.hooks?.beforeOperation ?? []),
            createConvertHook(resolved, limiter),
          ],
        },
      }
    })

    if (resolvedConfigs.length > 0) {
      // Per-collection overrides exclude ffmpegPath, so the plugin-level path is
      // the one every hook uses — a single boot probe covers all collections.
      const ffmpegPath = pluginResolved.ffmpegPath
      const codecs = [...new Set<VideoCodec>(resolvedConfigs.map((c) => c.encoding.codec))]
      const anySkips = resolvedConfigs.some((c) => c.onError === 'skip')

      const incomingOnInit = config.onInit
      config.onInit = async (payload) => {
        // Surface a broken install at boot instead of on the first editor upload.
        const check = await checkFfmpeg(ffmpegPath, requiredEncodersFor(codecs))
        if (!check.available) {
          payload.logger.warn(
            `[payload-video-webm] ffmpeg not found or not executable at "${ffmpegPath}" — video uploads will ${
              anySkips ? 'be stored unconverted' : 'fail'
            } until it is installed (or set ffmpegPath / FFMPEG_PATH)`,
          )
        } else if (check.missingEncoders.length > 0) {
          payload.logger.warn(
            `[payload-video-webm] ffmpeg at "${ffmpegPath}" is missing required encoders: ${check.missingEncoders.join(', ')} — conversions will fail until a build with libvpx/libopus is installed`,
          )
        }
        await incomingOnInit?.(payload)
      }
    }

    return config
  }

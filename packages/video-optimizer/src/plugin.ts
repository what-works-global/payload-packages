import type { BaseListFilter, CollectionConfig, Config, Where } from 'payload'

import type { ContinueChain, ConvertTaskRegistryEntry } from './jobs/convertTask.js'
import type {
  VideoCodec,
  VideoOptimizerCollectionOverrides,
  VideoOptimizerConfig,
} from './types.js'

import { signJobId } from './core/chain.js'
import { checkFfmpeg, requiredEncodersFor } from './core/convert.js'
import {
  configWarnings,
  DEFAULT_QUEUE,
  DEFAULT_RETRIES,
  DEFAULT_TASK_SLUG,
  mergeCollectionOverrides,
  resolveConfig,
  WEBM_MIME_TYPE,
} from './core/defaults.js'
import { Semaphore } from './core/semaphore.js'
import { mimeTypeMatches } from './core/shouldConvert.js'
import { createContinueEndpoint } from './endpoints/continue.js'
import { createRegenerateEndpoint } from './endpoints/regenerate.js'
import { conversionMetadataField, METADATA_GROUP_NAME } from './fields/conversionMetadataField.js'
import {
  EXCLUDE_VIDEO_DERIVATIVES,
  RENDITION_GENERATION_FIELD_NAME,
  RENDITION_PRESET_FIELD_NAME,
  renditionGenerationField,
  renditionPresetField,
  RENDITIONS_FIELD_NAME,
  renditionsField,
  VIDEO_DERIVATIVE_FLAG_FIELD_NAME,
  videoDerivativeFlagField,
} from './fields/sidecarFields.js'
import { createSidecarCleanupHook, createSidecarDeleteHook } from './hooks/sidecar.js'
import { createQueueHook, createStampHook } from './hooks/stampAndQueue.js'
import { createConvertTask } from './jobs/convertTask.js'

/** Import-map path of the live admin status panel (regenerate the import map after installing). */
export const VIDEO_PANEL_COMPONENT_PATH =
  '@whatworks/payload-video-optimizer/client#VideoConversionPanel'

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

const HIDE_DERIVATIVES: Where = EXCLUDE_VIDEO_DERIVATIVES

/**
 * Keeps plugin-managed sidecars out of the admin list view, composing with any
 * existing filter. This is the *only* place Payload applies it: relationship and
 * upload pickers build their own queries, so fields pointing at a converted
 * collection need `filterOptions: EXCLUDE_VIDEO_DERIVATIVES` of their own.
 */
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
  collections: VideoOptimizerConfig['collections'],
): Map<string, true | VideoOptimizerCollectionOverrides> | null => {
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
export const videoOptimizerPlugin =
  (pluginConfig: VideoOptimizerConfig = {}) =>
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
          throw new Error(`[payload-video-optimizer] collection "${slug}" does not exist`)
        }
        if (!isUploadCollection(collection)) {
          throw new Error(
            `[payload-video-optimizer] collection "${slug}" is not an upload collection — only upload collections can convert videos`,
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

    const taskSlug = pluginConfig.jobs?.taskSlug ?? DEFAULT_TASK_SLUG
    const queue = pluginConfig.jobs?.queue ?? DEFAULT_QUEUE
    const retries = pluginConfig.jobs?.retries ?? DEFAULT_RETRIES
    // `'inline'` is the same behaviour as leaving it unset, but chosen on purpose —
    // so it runs the job here too, and skips the boot warning below.
    const dispatch = typeof pluginConfig.dispatch === 'function' ? pluginConfig.dispatch : null
    const dispatchIsDeliberate = pluginConfig.dispatch !== undefined

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
        ...(hasNamedField(withMime, RENDITIONS_FIELD_NAME) ? [] : [renditionsField(withMime.slug)]),
        ...(hasNamedField(withMime, VIDEO_DERIVATIVE_FLAG_FIELD_NAME)
          ? []
          : [videoDerivativeFlagField()]),
        ...(hasNamedField(withMime, RENDITION_PRESET_FIELD_NAME) ? [] : [renditionPresetField()]),
        // Not gated on metadataFields: the generation counter is what keeps a stale
        // job from overwriting newer renditions, so it is never optional.
        ...(hasNamedField(withMime, RENDITION_GENERATION_FIELD_NAME)
          ? []
          : [renditionGenerationField()]),
        // Live control panel: polls while the job runs, then renders the condensed
        // rendition table with open/regenerate actions — no refreshing needed.
        ...(resolved.metadataFields
          ? [
              {
                name: 'videoConversionPanel',
                type: 'ui' as const,
                admin: {
                  components: {
                    Field: {
                      clientProps: {
                        // Labels live in the config, not on the document, so the
                        // panel is told them here rather than showing raw keys.
                        presetLabels: Object.fromEntries(
                          Object.entries(resolved.presets).map(([name, preset]) => [
                            name,
                            preset.label,
                          ]),
                        ),
                        regeneratePath: `/${taskSlug}/regenerate`,
                      },
                      path: VIDEO_PANEL_COMPONENT_PATH,
                    },
                  },
                  position: 'sidebar' as const,
                },
              },
            ]
          : []),
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

    if (registry.size === 0) {
      // Everything below — the task, the endpoints, the ffmpeg check, every boot
      // warning — hangs off this branch, so an empty registry means a plugin that
      // does nothing and says nothing. Reachable via `collections: []`, a config with
      // no upload collections, or another plugin adding one after this in the array.
      const incomingOnInit = config.onInit
      config.onInit = async (payload) => {
        payload.logger.warn(
          `[payload-video-optimizer] no upload collections are targeted, so nothing will be converted. Check the \`collections\` option, and that this plugin runs after any plugin that adds the collection.`,
        )
        await incomingOnInit?.(payload)
      }
      return config
    }

    {
      const existingTasks = config.jobs?.tasks ?? []
      if (existingTasks.some((task) => task.slug === taskSlug)) {
        throw new Error(
          `[payload-video-optimizer] a job task with slug "${taskSlug}" is already registered — running two plugin instances requires a distinct taskSlug per instance`,
        )
      }
      /**
       * Starts the next chunk of a run that stopped on `jobs.maxRunMs`.
       *
       * The row is queued either way — that is the durable continuation, and cron
       * settles it if the request below never lands. The request only buys latency:
       * without it the rest of the ladder waits for the next cron tick.
       *
       * Deliberately *not* handed to `dispatch`: on a serverless host that would run
       * the next chunk inside this same invocation, against the same timeout the
       * split exists to escape. It has to arrive as a new request.
       */
      const continueChain: ContinueChain = async ({
        collection,
        docId,
        generation,
        origin,
        req,
        sourceFilename,
      }) => {
        const job = (await req.payload.jobs.queue({
          input: { collection, docId, generation, origin, sourceFilename },
          queue,
          task: taskSlug,
        } as never)) as { id: number | string }

        // Without a *deferring* dispatch there is no fresh context to chain into:
        // the continue endpoint would run the chunk inline, and that re-enters the
        // per-document mutex this run is still holding — a deadlock, not a slowdown.
        // No origin means no web context at all (a CLI worker). Either way the row is
        // queued and whatever drains the queue picks it up.
        if (!dispatch || !origin) {
          return
        }
        const apiRoute = req.payload.config.routes?.api ?? '/api'
        try {
          await fetch(`${origin}${apiRoute}/${taskSlug}/continue`, {
            body: JSON.stringify({
              jobId: job.id,
              token: signJobId(req.payload.secret, job.id),
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
        } catch (error) {
          req.payload.logger.warn(
            `[payload-video-optimizer] could not start the next conversion chunk at ${origin} (${error instanceof Error ? error.message : String(error)}); the queued job stands and cron will pick it up`,
          )
        }
      }

      config.jobs = {
        ...config.jobs,
        tasks: [...existingTasks, createConvertTask(taskSlug, retries, registry, continueChain)],
      }
      config.endpoints = [
        ...(config.endpoints ?? []),
        createRegenerateEndpoint({ dispatch, queue, taskSlug }, registry),
        createContinueEndpoint({ dispatch, queue, taskSlug }),
      ]

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
            `[payload-video-optimizer] ffmpeg not found or not executable at "${ffmpegPath}" — conversion jobs will fail in this process until it is installed (or set ffmpeg.path / FFMPEG_PATH)`,
          )
        } else if (check.missingEncoders.length > 0) {
          payload.logger.warn(
            `[payload-video-optimizer] ffmpeg at "${ffmpegPath}" is missing required encoders: ${check.missingEncoders.join(', ')} — conversions will fail until a build with libvpx/libopus is installed`,
          )
        }
        // autoRun is the only drainer visible from here — an external cron or a
        // worker is not — so this can only ever be a hint, and an entry pointed at
        // another queue does not count.
        const autoRun = config.jobs?.autoRun
        const hasQueueDrainer =
          typeof autoRun === 'function' ||
          (Array.isArray(autoRun) &&
            autoRun.some((entry) => entry.queue === queue || entry.allQueues === true))

        for (const warning of configWarnings(pluginConfig, pluginResolved, {
          hasQueueDrainer,
          queue,
        })) {
          payload.logger.warn(`[payload-video-optimizer] ${warning}`)
        }
        if (!dispatchIsDeliberate) {
          payload.logger.warn(
            `[payload-video-optimizer] no dispatch configured — conversions run inline and the upload request waits for the encode (on a database with transactions they instead start detached, once the upload commits). Pass dispatch (e.g. Next's after(run), waitUntil(run()), or void run()) to background them properly, or dispatch: 'inline' to accept this.`,
          )
        }
        await incomingOnInit?.(payload)
      }
    }

    return config
  }

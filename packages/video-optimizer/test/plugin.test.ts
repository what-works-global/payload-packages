import type { CollectionConfig, Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { mergeCollectionOverrides } from '../src/core/defaults.js'
import {
  DEFAULT_TASK_SLUG,
  METADATA_GROUP_NAME,
  RENDITION_PRESET_FIELD_NAME,
  RENDITIONS_FIELD_NAME,
  VIDEO_DERIVATIVE_FLAG_FIELD_NAME,
  VIDEO_PANEL_COMPONENT_PATH,
  videoOptimizerPlugin,
} from '../src/index.js'

const baseConfig = (): Config =>
  ({
    collections: [
      {
        slug: 'media',
        fields: [],
        upload: {
          mimeTypes: ['video/mp4', 'image/*'],
          staticDir: '/tmp/media',
        },
      },
      { slug: 'files', fields: [], upload: true },
      { slug: 'posts', fields: [{ name: 'title', type: 'text' }] },
    ],
  }) as Config

const getCollection = (config: Config, slug: string): CollectionConfig => {
  const collection = config.collections?.find((candidate) => candidate.slug === slug)
  if (!collection) {
    throw new Error(`Collection ${slug} missing`)
  }
  return collection
}

const fieldNames = (collection: CollectionConfig): string[] =>
  collection.fields.map((f) => ('name' in f ? String(f.name) : ''))

const uploadMimeTypes = (collection: CollectionConfig): string[] | undefined =>
  typeof collection.upload === 'object' ? collection.upload.mimeTypes : undefined

describe('videoOptimizerPlugin config shaping', () => {
  it('wires stamp/queue/cleanup hooks and fields into every upload collection by default', () => {
    const config = videoOptimizerPlugin()(baseConfig())

    for (const slug of ['files', 'media']) {
      const collection = getCollection(config, slug)
      // Conversion is async — nothing touches req.file, so no beforeOperation hook.
      expect(collection.hooks?.beforeOperation).toBeUndefined()
      expect(collection.hooks?.beforeChange).toHaveLength(1)
      expect(collection.hooks?.afterChange).toHaveLength(2)
      expect(collection.hooks?.afterDelete).toHaveLength(1)

      const names = fieldNames(collection)
      expect(names).toContain(METADATA_GROUP_NAME)
      expect(names).toContain(RENDITIONS_FIELD_NAME)
      expect(names).toContain(VIDEO_DERIVATIVE_FLAG_FIELD_NAME)
      expect(names).toContain(RENDITION_PRESET_FIELD_NAME)
      expect(collection.admin?.baseListFilter).toBeDefined()

      // The live status panel points the import map at the ./client export and
      // carries the regenerate endpoint path — plus the preset labels, which live in
      // the config and would otherwise leave the sidebar showing raw preset keys.
      const panel = collection.fields.find((f) => 'name' in f && f.name === 'videoConversionPanel')
      expect(panel).toMatchObject({
        type: 'ui',
        admin: {
          components: {
            Field: {
              clientProps: {
                presetLabels: { '426w': '426px', '2560w': '2560px' },
                regeneratePath: '/video-convert/regenerate',
              },
              path: VIDEO_PANEL_COMPONENT_PATH,
            },
          },
        },
      })
    }

    const posts = getCollection(config, 'posts')
    expect(posts.hooks).toBeUndefined()
    expect(posts.fields).toHaveLength(1)
  })

  it('registers its endpoints under the task slug', () => {
    const config = videoOptimizerPlugin()(baseConfig())
    expect(config.endpoints?.find((e) => e.path === '/video-convert/regenerate')).toMatchObject({
      method: 'post',
    })
    expect(config.endpoints?.find((e) => e.path === '/video-convert/continue')).toMatchObject({
      method: 'post',
    })

    // Two instances get distinct endpoints, like distinct task slugs.
    const two = videoOptimizerPlugin({
      collections: ['files'],
      jobs: { taskSlug: 'video-optimizer-second' },
    })(videoOptimizerPlugin({ collections: ['media'] })(baseConfig()))
    expect(two.endpoints?.map((e) => e.path)).toEqual([
      '/video-convert/regenerate',
      '/video-convert/continue',
      '/video-optimizer-second/regenerate',
      '/video-optimizer-second/continue',
    ])
  })

  it('registers the durable conversion task once, with retries', () => {
    const config = videoOptimizerPlugin()(baseConfig())
    const tasks = config.jobs?.tasks ?? []
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ slug: DEFAULT_TASK_SLUG, retries: 3 })
    expect(
      videoOptimizerPlugin({ jobs: { retries: 5 } })(baseConfig()).jobs?.tasks?.[0],
    ).toMatchObject({
      retries: 5,
    })
  })

  it('rejects two plugin instances sharing a task slug, and accepts distinct slugs', () => {
    const withOne = videoOptimizerPlugin({ collections: ['media'] })(baseConfig())
    expect(() => videoOptimizerPlugin({ collections: ['files'] })(withOne)).toThrow(
      /already registered/,
    )

    const distinct = videoOptimizerPlugin({
      collections: ['files'],
      jobs: { taskSlug: 'video-optimizer-second' },
    })(videoOptimizerPlugin({ collections: ['media'] })(baseConfig()))
    expect(distinct.jobs?.tasks?.map((t) => t.slug)).toEqual([
      DEFAULT_TASK_SLUG,
      'video-optimizer-second',
    ])
  })

  it('widens a restrictive mimeTypes list with video/webm', () => {
    const config = videoOptimizerPlugin()(baseConfig())
    expect(uploadMimeTypes(getCollection(config, 'media'))).toEqual([
      'video/mp4',
      'image/*',
      'video/webm',
    ])
  })

  it('does not duplicate video/webm when the list already allows it', () => {
    const base = baseConfig()
    const media = getCollection(base, 'media')
    if (typeof media.upload === 'object') {
      media.upload.mimeTypes = ['video/*']
    }
    const config = videoOptimizerPlugin()(base)
    expect(uploadMimeTypes(getCollection(config, 'media'))).toEqual(['video/*'])
  })

  it('only touches listed collections when `collections` is set', () => {
    const config = videoOptimizerPlugin({ collections: ['media'] })(baseConfig())
    expect(getCollection(config, 'media').hooks?.beforeChange).toHaveLength(1)
    expect(getCollection(config, 'files').hooks).toBeUndefined()
  })

  it('accepts the object form with per-collection overrides', () => {
    const config = videoOptimizerPlugin({
      collections: {
        files: { metadataFields: false },
        media: true,
      },
    })(baseConfig())

    expect(fieldNames(getCollection(config, 'media'))).toContain(METADATA_GROUP_NAME)

    // metadataFields off drops the group and the panel but keeps the sidecar plumbing.
    const files = getCollection(config, 'files')
    expect(fieldNames(files)).not.toContain(METADATA_GROUP_NAME)
    expect(fieldNames(files)).not.toContain('videoConversionPanel')
    expect(fieldNames(files)).toContain(RENDITIONS_FIELD_NAME)
    expect(files.hooks?.beforeChange).toHaveLength(1)
  })

  it('composes the derivative list filter with an existing baseListFilter', async () => {
    const base = baseConfig()
    const media = getCollection(base, 'media')
    media.admin = { baseListFilter: () => ({ alt: { equals: 'kept' } }) }

    const config = videoOptimizerPlugin({ collections: ['media'] })(base)
    const filter = await getCollection(config, 'media').admin?.baseListFilter?.({} as never)
    expect(filter).toEqual({
      and: [
        { alt: { equals: 'kept' } },
        { [VIDEO_DERIVATIVE_FLAG_FIELD_NAME]: { not_equals: true } },
      ],
    })
  })

  it('merges per-collection encoding overrides over plugin-level encoding', () => {
    expect(
      mergeCollectionOverrides(
        { encoding: { codec: 'vp8', crf: 40 }, maxInputFileSize: 5 },
        { encoding: { crf: 30 } },
      ),
    ).toEqual({ encoding: { codec: 'vp8', crf: 30 }, maxInputFileSize: 5 })
  })

  it('validates object-form slugs and per-collection settings at init', () => {
    expect(() => videoOptimizerPlugin({ collections: { nope: true } })(baseConfig())).toThrow(
      /"nope" does not exist/,
    )
    expect(() =>
      videoOptimizerPlugin({ collections: { media: { encoding: { crf: 99 } } } })(baseConfig()),
    ).toThrow(/encoding\.crf/)
  })

  it('throws on unknown or non-upload collection slugs', () => {
    expect(() => videoOptimizerPlugin({ collections: ['nope'] })(baseConfig())).toThrow(
      /"nope" does not exist/,
    )
    expect(() => videoOptimizerPlugin({ collections: ['posts'] })(baseConfig())).toThrow(
      /not an upload collection/,
    )
  })

  it('skips metadata injection when the field already exists', () => {
    const base = baseConfig()
    getCollection(base, 'media').fields.push({ name: METADATA_GROUP_NAME, type: 'json' })
    const withExisting = videoOptimizerPlugin()(base)
    const fields = getCollection(withExisting, 'media').fields.filter(
      (f) => 'name' in f && f.name === METADATA_GROUP_NAME,
    )
    expect(fields).toHaveLength(1)
    expect(fields[0]?.type).toBe('json')
  })

  it('preserves existing hooks and onInit', () => {
    const base = baseConfig()
    const existingHook = () => undefined
    getCollection(base, 'media').hooks = { beforeChange: [existingHook] }
    base.onInit = () => undefined

    const config = videoOptimizerPlugin()(base)
    expect(getCollection(config, 'media').hooks?.beforeChange?.[0]).toBe(existingHook)
    expect(getCollection(config, 'media').hooks?.beforeChange).toHaveLength(2)
    expect(config.onInit).not.toBe(base.onInit)
  })

  it('returns the config untouched when disabled', () => {
    const base = baseConfig()
    const result = videoOptimizerPlugin({ enabled: false })(base)
    expect(result).toBe(base)
    expect(getCollection(result, 'media').hooks).toBeUndefined()
    expect(result.jobs).toBeUndefined()
    expect(result.onInit).toBeUndefined()
  })

  it('treats enabled: true the same as the default', () => {
    const config = videoOptimizerPlugin({ enabled: true })(baseConfig())
    expect(getCollection(config, 'media').hooks?.beforeChange).toHaveLength(1)
    expect(config.onInit).toBeDefined()
  })
})

import type { CollectionConfig, Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { mergeCollectionOverrides } from '../src/core/defaults.js'
import { METADATA_GROUP_NAME, videoWebmPlugin } from '../src/index.js'

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

const uploadMimeTypes = (collection: CollectionConfig): string[] | undefined =>
  typeof collection.upload === 'object' ? collection.upload.mimeTypes : undefined

describe('videoWebmPlugin config shaping', () => {
  it('targets every upload collection by default and leaves the rest alone', () => {
    const config = videoWebmPlugin()(baseConfig())

    for (const slug of ['files', 'media']) {
      const collection = getCollection(config, slug)
      expect(collection.hooks?.beforeOperation).toHaveLength(1)
      expect(collection.hooks?.beforeChange).toHaveLength(1)
      expect(collection.fields.some((f) => 'name' in f && f.name === METADATA_GROUP_NAME)).toBe(
        true,
      )
    }

    const posts = getCollection(config, 'posts')
    expect(posts.hooks).toBeUndefined()
    expect(posts.fields).toHaveLength(1)
  })

  it('widens a restrictive mimeTypes list with video/webm', () => {
    const config = videoWebmPlugin()(baseConfig())
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
    const config = videoWebmPlugin()(base)
    expect(uploadMimeTypes(getCollection(config, 'media'))).toEqual(['video/*'])
  })

  it('only touches listed collections when `collections` is set', () => {
    const config = videoWebmPlugin({ collections: ['media'] })(baseConfig())
    expect(getCollection(config, 'media').hooks?.beforeOperation).toHaveLength(1)
    expect(getCollection(config, 'files').hooks).toBeUndefined()
  })

  it('targets multiple listed collections', () => {
    const config = videoWebmPlugin({ collections: ['files', 'media'] })(baseConfig())
    expect(getCollection(config, 'media').hooks?.beforeOperation).toHaveLength(1)
    expect(getCollection(config, 'files').hooks?.beforeOperation).toHaveLength(1)
  })

  it('accepts the object form with per-collection overrides', () => {
    const config = videoWebmPlugin({
      collections: {
        files: { metadataFields: false },
        media: true,
      },
    })(baseConfig())

    const media = getCollection(config, 'media')
    expect(media.hooks?.beforeOperation).toHaveLength(1)
    expect(media.fields.some((f) => 'name' in f && f.name === METADATA_GROUP_NAME)).toBe(true)

    // The files collection overrode metadataFields, media kept the plugin default.
    const files = getCollection(config, 'files')
    expect(files.hooks?.beforeOperation).toHaveLength(1)
    expect(files.hooks?.beforeChange).toBeUndefined()
    expect(files.fields.some((f) => 'name' in f && f.name === METADATA_GROUP_NAME)).toBe(false)

    expect(getCollection(config, 'posts').hooks).toBeUndefined()
  })

  it('merges per-collection encoding overrides over plugin-level encoding', () => {
    expect(
      mergeCollectionOverrides(
        { encoding: { codec: 'vp8', crf: 40 }, onError: 'skip' },
        { encoding: { crf: 30 } },
      ),
    ).toEqual({ encoding: { codec: 'vp8', crf: 30 }, onError: 'skip' })
  })

  it('validates object-form slugs and per-collection settings at init', () => {
    expect(() => videoWebmPlugin({ collections: { nope: true } })(baseConfig())).toThrow(
      /"nope" does not exist/,
    )
    expect(() =>
      videoWebmPlugin({ collections: { media: { encoding: { crf: 99 } } } })(baseConfig()),
    ).toThrow(/encoding\.crf/)
  })

  it('throws on unknown or non-upload collection slugs', () => {
    expect(() => videoWebmPlugin({ collections: ['nope'] })(baseConfig())).toThrow(
      /"nope" does not exist/,
    )
    expect(() => videoWebmPlugin({ collections: ['posts'] })(baseConfig())).toThrow(
      /not an upload collection/,
    )
  })

  it('skips metadata injection when disabled or when the field already exists', () => {
    const disabled = videoWebmPlugin({ metadataFields: false })(baseConfig())
    const media = getCollection(disabled, 'media')
    expect(media.fields.some((f) => 'name' in f && f.name === METADATA_GROUP_NAME)).toBe(false)
    expect(media.hooks?.beforeChange).toBeUndefined()
    expect(media.hooks?.beforeOperation).toHaveLength(1)

    const base = baseConfig()
    getCollection(base, 'media').fields.push({ name: METADATA_GROUP_NAME, type: 'json' })
    const withExisting = videoWebmPlugin()(base)
    const fields = getCollection(withExisting, 'media').fields.filter(
      (f) => 'name' in f && f.name === METADATA_GROUP_NAME,
    )
    expect(fields).toHaveLength(1)
    expect(fields[0]?.type).toBe('json')
  })

  it('preserves existing hooks and onInit', () => {
    const base = baseConfig()
    const existingHook = () => undefined
    getCollection(base, 'media').hooks = { beforeOperation: [existingHook] }
    base.onInit = () => undefined

    const config = videoWebmPlugin()(base)
    expect(getCollection(config, 'media').hooks?.beforeOperation?.[0]).toBe(existingHook)
    expect(getCollection(config, 'media').hooks?.beforeOperation).toHaveLength(2)
    expect(config.onInit).not.toBe(base.onInit)
  })

  it('returns the config untouched when disabled', () => {
    const base = baseConfig()
    const result = videoWebmPlugin({ enabled: false })(base)
    expect(result).toBe(base)
    expect(getCollection(result, 'media').hooks).toBeUndefined()
    expect(result.onInit).toBeUndefined()
  })

  it('treats enabled: true the same as the default', () => {
    const config = videoWebmPlugin({ enabled: true })(baseConfig())
    expect(getCollection(config, 'media').hooks?.beforeOperation).toHaveLength(1)
    expect(config.onInit).toBeDefined()
  })
})

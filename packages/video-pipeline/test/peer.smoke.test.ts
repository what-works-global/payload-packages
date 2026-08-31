import type { CollectionConfig, Config } from 'payload'

import { afterEach, describe, expect, it } from 'vitest'

import { toVideoSources } from '../src/components/toVideoSources.js'
import { videoPipelinePlugin } from '../src/index.js'

const baseConfig = (): Partial<Config> => ({
  collections: [{ slug: 'media', fields: [], upload: true }],
})

const getCollection = (config: Config, slug: string): CollectionConfig => {
  const collection = config.collections?.find((c) => c.slug === slug)
  if (!collection) {
    throw new Error(`Collection ${slug} missing`)
  }
  return collection
}

describe('@whatworks/payload-video-pipeline peer smoke', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('throws when `collections` is missing or empty', () => {
    expect(() => videoPipelinePlugin({ collections: [] })(baseConfig() as Config)).toThrow(
      /`collections` is required/,
    )
  })

  it('adds the derivatives collection, settings global, and jobs config', () => {
    const result = videoPipelinePlugin({ collections: ['media'] })(baseConfig() as Config)

    const derivatives = getCollection(result, 'video-derivatives')
    expect(derivatives.upload).toBe(true)
    expect(derivatives.access?.create?.({} as never)).toBe(false)

    expect(result.globals?.some((g) => g.slug === 'video-pipeline-settings')).toBe(true)

    const taskSlugs = result.jobs?.tasks?.map((t) => t.slug)
    expect(taskSlugs).toEqual(['transcodeVideo', 'backfillVideoSizes'])

    expect(
      result.endpoints?.some((e) => e.path === '/video-pipeline/backfill' && e.method === 'post'),
    ).toBe(true)
  })

  it('wires the target collection with fields, a hook, and a regenerate endpoint', () => {
    const result = videoPipelinePlugin({ collections: ['media'] })(baseConfig() as Config)
    const media = getCollection(result, 'media')

    expect(media.fields.some((f) => 'name' in f && f.name === 'videoDerivatives')).toBe(true)
    expect(media.fields.some((f) => 'name' in f && f.name === 'videoRegenerateTrigger')).toBe(true)
    expect(media.hooks?.afterChange).toHaveLength(1)
    expect(media.endpoints && media.endpoints.some((e) => e.path === '/:id/regenerate-video')).toBe(
      true,
    )
  })

  it('leaves collections outside the plugin scope untouched', () => {
    const result = videoPipelinePlugin({ collections: ['media'] })({
      ...baseConfig(),
      collections: [...(baseConfig().collections ?? []), { slug: 'posts', fields: [] }],
    } as Config)

    const posts = getCollection(result, 'posts')
    expect(posts.hooks?.afterChange).toBeUndefined()
    expect(posts.fields.some((f) => 'name' in f && f.name === 'videoDerivatives')).toBe(false)
  })

  it('jobs.access.run allows a matching CRON_SECRET bearer token or a logged-in user', () => {
    process.env.CRON_SECRET = 'super-secret'
    const result = videoPipelinePlugin({ collections: ['media'] })(baseConfig() as Config)
    const run = result.jobs!.access!.run!

    const withSecret = { headers: new Headers({ authorization: 'Bearer super-secret' }) }
    const withWrongSecret = { headers: new Headers({ authorization: 'Bearer nope' }) }
    const withUser = { headers: new Headers(), user: { id: '1' } }
    const withNeither = { headers: new Headers() }

    expect(run({ req: withSecret } as never)).toBe(true)
    expect(run({ req: withWrongSecret } as never)).toBe(false)
    expect(run({ req: withUser } as never)).toBe(true)
    expect(run({ req: withNeither } as never)).toBe(false)
  })

  it('toVideoSources keeps only populated, done derivatives', () => {
    expect(
      toVideoSources([
        { derivative: { id: '1', mimeType: 'video/webm', url: '/a.webm' }, status: 'pending' },
        { derivative: 'unpopulated-id', status: 'done' },
        {
          breakpointMinWidth: 768,
          derivative: { id: '3', mimeType: 'video/webm', url: '/c.webm' },
          status: 'done',
        },
        { derivative: null, status: 'error' },
      ]),
    ).toEqual([{ breakpointMinWidth: 768, mimeType: 'video/webm', url: '/c.webm' }])
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  getRenditionUrl,
  getVideoSources,
  getVideoSourceSet,
  getVideoVariants,
  pickVideoVariant,
} from '../src/exports/frontend.js'

const populated = {
  mimeType: 'video/mp4',
  renditions: [
    { preset: '720p', video: { mimeType: 'video/webm', url: '/media/clip-720p.webm' } },
    { preset: '360p', video: { mimeType: 'video/webm', url: '/media/clip-360p.webm' } },
  ],
  url: '/media/clip.mp4',
}

describe('getVideoSources', () => {
  it('lists renditions in preference order with the original as the final fallback', () => {
    expect(getVideoSources(populated)).toEqual([
      { type: 'video/webm', preset: '720p', src: '/media/clip-720p.webm' },
      { type: 'video/webm', preset: '360p', src: '/media/clip-360p.webm' },
      { type: 'video/mp4', preset: null, src: '/media/clip.mp4' },
    ])
  })

  it('restricts and re-orders via the presets option, keeping the fallback', () => {
    const sources = getVideoSources(populated, { presets: ['360p'] })
    expect(sources.map((s) => s.preset)).toEqual(['360p', null])
  })

  it('degrades to just the original for unpopulated rows, pending conversions, and non-videos', () => {
    // depth: 0 — relationship rows are bare ids.
    const unpopulated = { ...populated, renditions: [{ preset: '720p', video: 7 }] }
    expect(getVideoSources(unpopulated)).toEqual([
      { type: 'video/mp4', preset: null, src: '/media/clip.mp4' },
    ])
    // still queued / skipped — no rows at all.
    expect(getVideoSources({ mimeType: 'image/png', url: '/media/pic.png' })).toEqual([
      { type: 'image/png', preset: null, src: '/media/pic.png' },
    ])
  })

  it('returns an empty list for null-ish documents', () => {
    expect(getVideoSources(null)).toEqual([])
    expect(getVideoSources(undefined)).toEqual([])
  })
})

describe('getRenditionUrl', () => {
  it('returns the preferred rendition, a named preset, or null', () => {
    expect(getRenditionUrl(populated)).toBe('/media/clip-720p.webm')
    expect(getRenditionUrl(populated, '360p')).toBe('/media/clip-360p.webm')
    expect(getRenditionUrl(populated, 'nope')).toBeNull()
    expect(getRenditionUrl({ url: '/media/clip.mp4' })).toBeNull()
    expect(getRenditionUrl(null)).toBeNull()
  })
})

/** A landscape master with the plan's ladder plus a portrait crop family. */
const ladder = {
  mimeType: 'video/mp4',
  renditions: [
    { height: 720, preset: '1280w', video: { url: '/media/hero-1280w.webm' }, width: 1280 },
    { height: 480, preset: '854w', video: { url: '/media/hero-854w.webm' }, width: 854 },
    { height: 360, preset: '640w', video: { url: '/media/hero-640w.webm' }, width: 640 },
    {
      height: 1920,
      preset: 'portrait-1080w',
      video: { url: '/media/hero-portrait.webm' },
      width: 1080,
    },
  ],
  url: '/media/hero.mp4',
}

describe('pickVideoVariant', () => {
  it('picks the smallest rendition that still covers the slot', () => {
    expect(pickVideoVariant(ladder, { width: 640 })?.preset).toBe('640w')
    expect(pickVideoVariant(ladder, { width: 700 })?.preset).toBe('854w')
    expect(pickVideoVariant(ladder, { width: 854 })?.preset).toBe('854w')
  })

  it('accounts for device pixel ratio', () => {
    // The same CSS slot needs a wider file on a retina screen.
    expect(pickVideoVariant(ladder, { dpr: 1, width: 400 })?.preset).toBe('640w')
    expect(pickVideoVariant(ladder, { dpr: 2, width: 400 })?.preset).toBe('854w')
  })

  it('falls back to the largest rendition when the slot outgrows the ladder', () => {
    expect(pickVideoVariant(ladder, { dpr: 2, width: 1920 })?.preset).toBe('1280w')
  })

  it('switches to the cropped family only when covering would overdraw too much', () => {
    // A 16:9 slot: the source-ratio family covers perfectly.
    expect(pickVideoVariant(ladder, { height: 360, width: 640 })?.preset).toBe('640w')
    // A 4:3-ish slot: overdraw stays under 2×, so covering beats an extra download.
    expect(pickVideoVariant(ladder, { height: 480, width: 640 })?.preset).toBe('640w')
    // A 9:16 phone hero: covering with a landscape file wastes ~3× the pixels.
    expect(pickVideoVariant(ladder, { height: 800, width: 450 })?.preset).toBe('portrait-1080w')
  })

  it('never switches to a worse-shaped family, however tight the tolerance', () => {
    // The 4:3 slot exceeds a 1.1 tolerance, but the only alternative shape is
    // further away still — switching would download more pixels, not fewer.
    expect(pickVideoVariant(ladder, { height: 480, maxOverdraw: 1.1, width: 640 })?.preset).toBe(
      '640w',
    )
  })

  it('never returns a crop when the slot shape is unknown', () => {
    // No height means no shape to match. A crop is different framing, not a wider
    // file, so it must not be chosen just because its pixel width happens to fit.
    for (const width of [700, 900, 1000, 1080]) {
      expect(pickVideoVariant(ladder, { width })?.preset).not.toBe('portrait-1080w')
    }
  })

  it('treats a rounded ladder as one shape', () => {
    // 854x480 is 1.7792 and 1280x720 is 1.7778 — the same 16:9 ladder in practice.
    // Comparing ratios exactly would strand each rung in its own family.
    expect(pickVideoVariant(ladder, { height: 394, width: 700 })?.preset).toBe('854w')
  })

  it('returns null when nothing is stored yet, so callers fall back to the source', () => {
    expect(pickVideoVariant({ url: '/media/hero.mp4' }, { width: 640 })).toBeNull()
    expect(pickVideoVariant(null, { width: 640 })).toBeNull()
  })
})

describe('getVideoVariants', () => {
  it('exposes measured dimensions and aspect ratio for custom pickers', () => {
    expect(getVideoVariants(ladder)[0]).toEqual({
      type: 'video/webm',
      aspectRatio: 1280 / 720,
      height: 720,
      preset: '1280w',
      src: '/media/hero-1280w.webm',
      width: 1280,
    })
    // Rows the job recorded as skipped carry no file, so they are not variants.
    expect(
      getVideoVariants({ renditions: [{ preset: '2560w', skippedReason: 'source-smaller' }] }),
    ).toEqual([])
  })
})

describe('getVideoSourceSet', () => {
  it('emits one media-gated source per rule, widest first, original last', () => {
    const sources = getVideoSourceSet(ladder, {
      dpr: 1,
      sizes: [{ minWidth: 1024, width: 900 }, { minWidth: 640, width: 700 }, { width: 400 }],
    })

    expect(sources).toEqual([
      {
        type: 'video/webm',
        media: '(min-width: 1024px)',
        preset: '1280w',
        src: '/media/hero-1280w.webm',
      },
      {
        type: 'video/webm',
        media: '(min-width: 640px)',
        preset: '854w',
        src: '/media/hero-854w.webm',
      },
      // The unconditional rule carries no media query…
      { type: 'video/webm', preset: '640w', src: '/media/hero-640w.webm' },
      // …and the original is always the final fallback.
      { type: 'video/mp4', preset: null, src: '/media/hero.mp4' },
    ])
  })

  it('honours explicit media queries, including orientation for the portrait crop', () => {
    const sources = getVideoSourceSet(ladder, {
      dpr: 2,
      sizes: [
        { height: 800, media: '(orientation: portrait) and (max-width: 767px)', width: 400 },
        { width: 900 },
      ],
    })
    expect(sources[0]).toMatchObject({
      media: '(orientation: portrait) and (max-width: 767px)',
      preset: 'portrait-1080w',
    })
    expect(sources[1]).toMatchObject({ preset: '1280w' })
  })

  it('solves exact crossovers from a sizes string, per dpr bucket', () => {
    const sources = getVideoSourceSet(ladder, {
      sizes: '(min-width: 1024px) 900px, calc(50vw - 24px)',
    })

    // Widest band first within each bucket, buckets highest-dpr first, and the
    // lowest bucket carries no resolution query because it is the fallback.
    expect(sources.map((source) => [source.media, source.preset])).toEqual([
      ['(min-width: 903px) and (min-resolution: 1.5dppx)', '1280w'],
      ['(min-width: 689px) and (min-resolution: 1.5dppx)', '854w'],
      ['(min-resolution: 1.5dppx)', '640w'],
      ['(min-width: 1024px)', '1280w'],
      [undefined, '640w'],
      [undefined, null],
    ])
  })

  it('emits breakpoints the stylesheet never mentions', () => {
    // 903 is not a CSS breakpoint — it is where `calc(50vw - 24px)` at 2x stops
    // fitting the 854w rung. Nobody could write it by hand without the ladder.
    const media = getVideoSourceSet(ladder, { sizes: 'calc(50vw - 24px)' }).map((s) => s.media)
    expect(media).toContain('(min-width: 903px) and (min-resolution: 1.5dppx)')
  })

  it('defaults to 1x and 2x, and a scalar dpr keeps the pre-bucket behaviour', () => {
    const bucketed = getVideoSourceSet(ladder, { sizes: '100vw' })
    expect(bucketed.some((source) => source.media?.includes('min-resolution'))).toBe(true)

    const scalar = getVideoSourceSet(ladder, { dpr: 2, sizes: '100vw' })
    expect(scalar.every((source) => !source.media?.includes('min-resolution'))).toBe(true)
  })

  it('drops a source already served by the next, broader one', () => {
    // One rung: every band resolves to it, so all but the broadest query are noise.
    const single = {
      mimeType: 'video/mp4',
      renditions: [
        {
          height: 360,
          preset: '640w',
          video: { mimeType: 'video/webm', url: '/media/hero-640w.webm' },
          width: 640,
        },
      ],
      url: '/media/hero.mp4',
    }
    expect(getVideoSourceSet(single, { sizes: '100vw' })).toEqual([
      { type: 'video/webm', preset: '640w', src: '/media/hero-640w.webm' },
      { type: 'video/mp4', preset: null, src: '/media/hero.mp4' },
    ])
  })

  it('switches to the cropped family where aspect says the slot changes shape', () => {
    const sources = getVideoSourceSet(ladder, {
      aspect: '(min-width: 768px) 16/9, 9/16',
      dpr: 1,
      sizes: '(min-width: 768px) 1200px, 100vw',
    })
    expect(sources.at(0)).toMatchObject({ media: '(min-width: 768px)', preset: '1280w' })
    expect(sources.at(-2)).toMatchObject({ preset: 'portrait-1080w' })
  })

  it('keeps an explicit media rule even when a later rule resolves to the same file', () => {
    // Dropping an adjacent duplicate is only sound for a pure min-width chain. Here
    // the portrait rule and the sidebar rule both want 426w — trimming the first
    // leaves a 390px phone matching neither, so it takes the unconditional rule and
    // downloads 1280w into a 400px slot: 9x the pixels, on the exact device the
    // rule existed to protect.
    const sources = getVideoSourceSet(ladder, {
      dpr: 1,
      sizes: [
        { media: '(orientation: portrait)', width: 400 },
        { minWidth: 900, width: 400 },
        { width: 1200 },
      ],
    })
    expect(sources.map((source) => source.media)).toEqual([
      '(orientation: portrait)',
      '(min-width: 900px)',
      undefined,
      undefined,
    ])
  })

  it('falls back to just the original while nothing is stored', () => {
    expect(getVideoSourceSet({ url: '/media/hero.mp4' }, { sizes: [{ width: 400 }] })).toEqual([
      { type: 'video/mp4', preset: null, src: '/media/hero.mp4' },
    ])
  })
})

describe('unpopulated rows', () => {
  it('warns once in development, because the original is served instead', async () => {
    // A fresh module: the warning deliberately fires only once per process.
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const fresh = await import('../src/exports/frontend.js')
      // depth 1 through a relationship: rows exist, but the videos are bare ids.
      const shallow = { renditions: [{ preset: '1280w', video: 42 }], url: '/media/hero.mp4' }
      expect(fresh.getVideoSources(shallow).map((s) => s.preset)).toEqual([null])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('depth'))

      fresh.getVideoSources(shallow)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('stays silent for rows that record a deliberate skip', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      getVideoSources({
        renditions: [{ preset: '2560w', skippedReason: 'source-smaller' }],
        url: '/media/hero.mp4',
      })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

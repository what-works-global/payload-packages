import { describe, expect, it, vi } from 'vitest'

import {
  getVideoSources,
  getVideoSourceSet,
  getVideoVariants,
  getWebmUrl,
  pickVideoVariant,
} from '../src/exports/frontend.js'

const populated = {
  mimeType: 'video/mp4',
  url: '/media/clip.mp4',
  webmVersions: [
    { preset: '720p', video: { mimeType: 'video/webm', url: '/media/clip-720p.webm' } },
    { preset: '360p', video: { mimeType: 'video/webm', url: '/media/clip-360p.webm' } },
  ],
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
    const unpopulated = { ...populated, webmVersions: [{ preset: '720p', video: 7 }] }
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

describe('getWebmUrl', () => {
  it('returns the preferred rendition, a named preset, or null', () => {
    expect(getWebmUrl(populated)).toBe('/media/clip-720p.webm')
    expect(getWebmUrl(populated, '360p')).toBe('/media/clip-360p.webm')
    expect(getWebmUrl(populated, 'nope')).toBeNull()
    expect(getWebmUrl({ url: '/media/clip.mp4' })).toBeNull()
    expect(getWebmUrl(null)).toBeNull()
  })
})

/** A landscape master with the plan's ladder plus a portrait crop family. */
const ladder = {
  mimeType: 'video/mp4',
  url: '/media/hero.mp4',
  webmVersions: [
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
      getVideoVariants({ webmVersions: [{ preset: '2560w', skippedReason: 'source-smaller' }] }),
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
      const shallow = { url: '/media/hero.mp4', webmVersions: [{ preset: '1280w', video: 42 }] }
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
        url: '/media/hero.mp4',
        webmVersions: [{ preset: '2560w', skippedReason: 'source-smaller' }],
      })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

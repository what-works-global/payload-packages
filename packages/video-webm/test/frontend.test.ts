import { describe, expect, it } from 'vitest'

import { getVideoSources, getWebmUrl } from '../src/exports/frontend.js'

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

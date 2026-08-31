import { describe, expect, it } from 'vitest'

import { summariseSkipped } from '../src/components/skipSummary.js'

describe('summariseSkipped', () => {
  it('says nothing when every preset was stored', () => {
    expect(summariseSkipped([])).toBeNull()
  })

  it('translates the recorded reason into words', () => {
    expect(summariseSkipped([{ preset: '720p', skippedReason: 'output-larger' }])).toBe(
      '720p: larger than source',
    )
    expect(summariseSkipped([{ preset: '1080p', skippedReason: 'source-smaller' }])).toBe(
      '1080p: source too small',
    )
  })

  it('groups presets that share a reason and uses their labels', () => {
    expect(
      summariseSkipped(
        [
          { preset: '720p', skippedReason: 'output-larger' },
          { preset: 'webm', skippedReason: 'output-larger' },
        ],
        { webm: 'Original quality' },
      ),
    ).toBe('720p and Original quality: larger than source')
  })

  it('separates differing reasons, listing three or more presets readably', () => {
    expect(
      summariseSkipped([
        { preset: '720p', skippedReason: 'output-larger' },
        { preset: '1080p', skippedReason: 'source-smaller' },
        { preset: '1440p', skippedReason: 'source-smaller' },
        { preset: '2160p', skippedReason: 'source-smaller' },
      ]),
    ).toBe('720p: larger than source · 1080p, 1440p and 2160p: source too small')
  })

  it('falls back to the raw reason a newer plugin version might write', () => {
    expect(summariseSkipped([{ preset: '720p', skippedReason: 'something-new' }])).toBe(
      '720p: something-new',
    )
    expect(summariseSkipped([{ preset: '720p', skippedReason: null }])).toBe('720p: not stored')
  })
})

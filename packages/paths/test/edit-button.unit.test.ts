import { describe, expect, it } from 'vitest'

import { isHintFresh, nearestCorner } from '../src/client/storage.js'

describe('nearestCorner', () => {
  it('snaps each viewport quadrant to its corner', () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe('top-left')
    expect(nearestCorner(990, 10, 1000, 800)).toBe('top-right')
    expect(nearestCorner(10, 790, 1000, 800)).toBe('bottom-left')
    expect(nearestCorner(990, 790, 1000, 800)).toBe('bottom-right')
  })

  it('treats the exact centre as the bottom-right quadrant boundary', () => {
    // >= centre goes right/bottom — matches the strict `<` checks.
    expect(nearestCorner(500, 400, 1000, 800)).toBe('bottom-right')
    expect(nearestCorner(499, 399, 1000, 800)).toBe('top-left')
  })
})

describe('isHintFresh', () => {
  const now = 1_700_000_000_000
  const day = 24 * 60 * 60 * 1000

  it('accepts a recent stamp and rejects an expired one', () => {
    expect(isHintFresh(String(now - day), now, 30 * day)).toBe(true)
    expect(isHintFresh(String(now - 31 * day), now, 30 * day)).toBe(false)
  })

  it('rejects missing, malformed, and future stamps', () => {
    expect(isHintFresh(null, now)).toBe(false)
    expect(isHintFresh('', now)).toBe(false)
    expect(isHintFresh('not-a-number', now)).toBe(false)
    expect(isHintFresh(String(now + day), now)).toBe(false)
  })
})

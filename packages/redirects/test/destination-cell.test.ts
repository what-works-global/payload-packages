import { describe, expect, it } from 'vitest'

import { isLinkableCustomDestination } from '../src/cells/shared.js'

describe('isLinkableCustomDestination', () => {
  it('does not link a regex destination that references capture groups', () => {
    expect(isLinkableCustomDestination('/$1', 'regex')).toBe(false)
    expect(isLinkableCustomDestination('/blog/$2/$1', 'regex')).toBe(false)
    expect(isLinkableCustomDestination('https://example.com/$1', 'regex')).toBe(false)
  })

  it('links a regex destination with a fixed URL (no capture groups)', () => {
    expect(isLinkableCustomDestination('/new-home', 'regex')).toBe(true)
    expect(isLinkableCustomDestination('https://example.com/moved', 'regex')).toBe(true)
  })

  it('links every non-regex destination, treating $n as a literal', () => {
    expect(isLinkableCustomDestination('/about', 'exact')).toBe(true)
    expect(isLinkableCustomDestination('/new-section', 'startsWith')).toBe(true)
    expect(isLinkableCustomDestination('https://www.google.com', 'exact')).toBe(true)
    // A literal `$1` in a non-regex destination is never substituted, so it links.
    expect(isLinkableCustomDestination('/price-$1', 'contains')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { chunkFileName, matchChunkFile } from '../src/core/chunks.js'

describe('chunkFileName', () => {
  it('is one-based', () => {
    expect(chunkFileName('pages', 0)).toBe('pages-1.xml')
    expect(chunkFileName('pages', 11)).toBe('pages-12.xml')
  })
})

describe('matchChunkFile', () => {
  const groups = ['pages', 'foo-2', '_routes']

  it('matches simple group names', () => {
    expect(matchChunkFile('pages-1.xml', groups)).toEqual({ group: 'pages', index: 0 })
    expect(matchChunkFile('pages-12.xml', groups)).toEqual({ group: 'pages', index: 11 })
  })

  it('matches group slugs containing hyphens and digits', () => {
    expect(matchChunkFile('foo-2-3.xml', groups)).toEqual({ group: 'foo-2', index: 2 })
  })

  it('matches the reserved routes group', () => {
    expect(matchChunkFile('_routes-1.xml', groups)).toEqual({ group: '_routes', index: 0 })
  })

  it('rejects unknown groups, zero, and malformed indices', () => {
    expect(matchChunkFile('unknown-1.xml', groups)).toBeNull()
    expect(matchChunkFile('pages-0.xml', groups)).toBeNull()
    expect(matchChunkFile('pages-01.xml', groups)).toBeNull()
    expect(matchChunkFile('pages-1.xml.gz', groups)).toBeNull()
    expect(matchChunkFile('pages.xml', groups)).toBeNull()
  })
})

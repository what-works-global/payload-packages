import { describe, expect, it } from 'vitest'

import {
  getPathnameWithoutPageNumber,
  getPathnameWithPageNumber,
  getSlugSegments,
  pagePathPagination,
  parsePaginatedSlugSegments,
} from '../src/core/pagination.js'
import {
  appendSegment,
  composeUrl,
  normalizePrefix,
  pathToSegments,
  segmentsToPath,
  stripPrefix,
} from '../src/core/shared.js'
import { memoryPathsCache } from '../src/exports/cache.js'
import { createNestedDocsGenerateURL } from '../src/index.js'

describe('path primitives', () => {
  it('normalizes prefixes', () => {
    expect(normalizePrefix('')).toBe('')
    expect(normalizePrefix('/')).toBe('')
    expect(normalizePrefix('blog')).toBe('/blog')
    expect(normalizePrefix('/blog/')).toBe('/blog')
    expect(normalizePrefix('/blog//')).toBe('/blog')
  })

  it('round-trips segments and paths', () => {
    expect(segmentsToPath([])).toBe('/')
    expect(segmentsToPath(['a', 'b'])).toBe('/a/b')
    expect(pathToSegments('/')).toEqual([])
    expect(pathToSegments('/a/b')).toEqual(['a', 'b'])
  })

  it('appends segments treating "/" as the empty root', () => {
    expect(appendSegment('/', 'about')).toBe('/about')
    expect(appendSegment('/about', 'team')).toBe('/about/team')
  })

  it('composes URLs from prefixes and paths', () => {
    expect(composeUrl('', '/about')).toBe('/about')
    expect(composeUrl('', '/')).toBe('/')
    expect(composeUrl('/blog', '/')).toBe('/blog')
    expect(composeUrl('/blog', '/hello')).toBe('/blog/hello')
  })

  it('strips prefixes from request pathnames', () => {
    expect(stripPrefix('', '/about')).toBe('/about')
    expect(stripPrefix('/blog', '/blog')).toBe('/')
    expect(stripPrefix('/blog', '/blog/hello')).toBe('/hello')
    expect(stripPrefix('/blog', '/bloghello')).toBeNull()
    expect(stripPrefix('/blog', '/other/hello')).toBeNull()
  })
})

describe('pagination parsing', () => {
  it('coerces route params to segments', () => {
    expect(getSlugSegments(undefined)).toEqual([])
    expect(getSlugSegments('a')).toEqual(['a'])
    expect(getSlugSegments(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('parses /page/N suffixes', () => {
    expect(parsePaginatedSlugSegments(['guides', 'page', '2'])).toEqual({
      documentSegments: ['guides'],
      pageNumber: 2,
    })
    expect(parsePaginatedSlugSegments(['guides', 'page', '1'])).toEqual({
      documentSegments: ['guides'],
      redirectToDocumentPath: true,
    })
    expect(parsePaginatedSlugSegments(['guides', 'page', '10000'])).toEqual({
      documentSegments: ['guides'],
      invalidPage: true,
    })
    expect(parsePaginatedSlugSegments(['guides', 'page', '02'])).toEqual({
      documentSegments: ['guides', 'page', '02'],
    })
    expect(parsePaginatedSlugSegments(['guides'])).toEqual({ documentSegments: ['guides'] })
  })

  it('rewrites pathnames with and without page numbers', () => {
    expect(getPathnameWithoutPageNumber('/guides/page/3')).toBe('/guides')
    expect(getPathnameWithoutPageNumber('/guides')).toBe('/guides')
    expect(getPathnameWithPageNumber('/guides', 3)).toBe('/guides/page/3')
    expect(getPathnameWithPageNumber('/guides', 1)).toBe('/guides')
    expect(getPathnameWithPageNumber('/', 2)).toBe('/page/2')
  })
})

describe('pagePathPagination strategy', () => {
  it('defaults to the /page/N scheme (parsePaginatedSlugSegments is this frozen)', () => {
    const strategy = pagePathPagination()
    for (const segments of [
      ['guides', 'page', '2'],
      ['guides', 'page', '1'],
      ['guides', 'page', '10000'],
      ['guides'],
    ]) {
      expect(strategy.parse(segments)).toEqual(parsePaginatedSlugSegments(segments))
    }
  })

  it('renames the page segment', () => {
    const strategy = pagePathPagination({ segment: 'p' })
    expect(strategy.parse(['guides', 'p', '2'])).toEqual({
      documentSegments: ['guides'],
      pageNumber: 2,
    })
    // The default keyword no longer paginates — it is just a document segment.
    expect(strategy.parse(['guides', 'page', '2'])).toEqual({
      documentSegments: ['guides', 'page', '2'],
    })
  })

  it('serves page 1 in place when redirectFirstPage is false', () => {
    const strategy = pagePathPagination({ redirectFirstPage: false })
    expect(strategy.parse(['guides', 'page', '1'])).toEqual({
      documentSegments: ['guides'],
      pageNumber: 1,
    })
  })

  it('honours a custom maxPageNumber', () => {
    const strategy = pagePathPagination({ maxPageNumber: 3 })
    expect(strategy.parse(['guides', 'page', '3'])).toEqual({
      documentSegments: ['guides'],
      pageNumber: 3,
    })
    expect(strategy.parse(['guides', 'page', '4'])).toEqual({
      documentSegments: ['guides'],
      invalidPage: true,
    })
  })
})

describe('createNestedDocsGenerateURL', () => {
  const generateURL = createNestedDocsGenerateURL({ homeSlug: 'home', prefix: '' })

  it('matches the stored-path semantics', () => {
    expect(generateURL([{ slug: 'home' }])).toBe('/')
    expect(generateURL([{ slug: 'about' }])).toBe('/about')
    expect(generateURL([{ slug: 'about' }, { slug: 'team' }])).toBe('/about/team')
  })

  it('applies prefixes', () => {
    const prefixed = createNestedDocsGenerateURL({ homeSlug: 'home', prefix: '/blog' })
    expect(prefixed([{ slug: 'home' }])).toBe('/blog')
    expect(prefixed([{ slug: 'hello' }])).toBe('/blog/hello')
  })
})

describe('memoryPathsCache', () => {
  it('memoizes by key and invalidates by tag', async () => {
    const cache = memoryPathsCache()
    let loads = 0
    const loader = cache.wrap(
      () => {
        loads += 1
        return Promise.resolve(loads)
      },
      { key: ['a'], tags: ['tag-a'] },
    )

    expect(await loader()).toBe(1)
    expect(await loader()).toBe(1)

    await cache.invalidate(['tag-b'])
    expect(await loader()).toBe(1)

    await cache.invalidate(['tag-a'])
    expect(await loader()).toBe(2)
  })

  it('expires entries after the TTL', async () => {
    const cache = memoryPathsCache({ ttlMs: -1 })
    let loads = 0
    const loader = cache.wrap(
      () => {
        loads += 1
        return Promise.resolve(loads)
      },
      { key: ['a'], tags: [] },
    )
    expect(await loader()).toBe(1)
    expect(await loader()).toBe(2)
  })
})

/**
 * Pagination-suffix parsing, shared by the resolver and exported for apps that
 * build pagination links. Framework-free.
 *
 * The `/page/N` URL scheme is the DEFAULT, not the only option: the resolver
 * accepts a {@link PaginationStrategy}, so an app can rename the segment
 * keyword, drop the page-1 → canonical redirect, replace the scheme entirely,
 * or turn pagination off (`pagination: false`). {@link pagePathPagination} is
 * the configurable default; {@link parsePaginatedSlugSegments} is that default
 * frozen as a standalone function for link builders and back-compat.
 */

const PAGE_SEGMENT = 'page'
const MAX_PAGE_NUMBER = 9999

export type PaginatedSlugSegments = {
  /** The segments with any `/page/N` suffix removed. */
  documentSegments: string[]
  /** True when the suffix parsed as a page but the number is out of range. */
  invalidPage?: boolean
  /** The parsed page number, for pages 2 and up (1 too when page 1 is served in place). */
  pageNumber?: number
  /** True for `/page/1`, which should redirect to the bare document path. */
  redirectToDocumentPath?: boolean
}

/**
 * A pluggable pagination scheme. `parse` receives a request's segments — only
 * consulted after an exact-path lookup MISSES — and decides whether the tail
 * encodes a page number and what the base document path is. Return
 * `{ documentSegments: segments }` with no `pageNumber`/`redirectToDocumentPath`
 * to decline; the resolver then reports not-found. Pass `pagination: false` to
 * the resolver to skip parsing entirely.
 */
export type PaginationStrategy = {
  parse: (segments: string[]) => PaginatedSlugSegments
}

const isPositiveIntegerString = (value: string | undefined): value is string =>
  typeof value === 'string' && /^[1-9]\d*$/u.test(value)

/** Coerce a `[[...slug]]` route param into a segments array. */
export const getSlugSegments = (slug?: null | string | string[]): string[] => {
  if (Array.isArray(slug)) {
    return slug
  }
  return slug ? [slug] : []
}

export type PagePathPaginationOptions = {
  /**
   * Cap on the page number; a larger value is treated as not-found rather than
   * a valid page (a cheap guard against unbounded crawl URLs).
   * @default 9999
   */
  maxPageNumber?: number
  /**
   * Redirect `/…/<segment>/1` to the canonical bare document path. Set `false`
   * to serve page 1 in place instead — the resolution then carries
   * `pageNumber: 1` and no redirect (useful when you want stable pagination
   * URLs for every page, at the cost of a duplicate-content URL for page 1).
   * @default true
   */
  redirectFirstPage?: boolean
  /**
   * The literal segment that precedes the page number: `'page'` → `/blog/page/2`,
   * `'p'` → `/blog/p/2`.
   * @default 'page'
   */
  segment?: string
}

/**
 * The default pagination strategy: a trailing `/<segment>/<n>` pair (`segment`
 * defaults to `'page'`). An exact-path match is always tried first by the
 * resolver, so a real document at `/docs/page/2` wins over pagination parsing.
 */
export const pagePathPagination = (options: PagePathPaginationOptions = {}): PaginationStrategy => {
  const {
    maxPageNumber = MAX_PAGE_NUMBER,
    redirectFirstPage = true,
    segment = PAGE_SEGMENT,
  } = options

  return {
    parse: (segments) => {
      const pageSegment = segments[segments.length - 2]
      const pageNumberSegment = segments[segments.length - 1]

      if (pageSegment !== segment || !isPositiveIntegerString(pageNumberSegment)) {
        return { documentSegments: segments }
      }

      const pageNumber = Number.parseInt(pageNumberSegment, 10)
      const documentSegments = segments.slice(0, -2)

      if (pageNumber === 1) {
        return redirectFirstPage
          ? { documentSegments, redirectToDocumentPath: true }
          : { documentSegments, pageNumber: 1 }
      }

      if (pageNumber > maxPageNumber) {
        return { documentSegments, invalidPage: true }
      }

      return { documentSegments, pageNumber }
    },
  }
}

const defaultPagination = pagePathPagination()

/**
 * Detect a trailing `/page/N` pair — the default {@link pagePathPagination}
 * scheme, frozen as a standalone function for apps building pagination links
 * and for back-compat. The resolver itself uses a configurable
 * {@link PaginationStrategy}.
 */
export const parsePaginatedSlugSegments = (segments: string[]): PaginatedSlugSegments =>
  defaultPagination.parse(segments)

/** `/guides/page/3?x=1` → `/guides` (query dropped, trailing slash preserved). */
export const getPathnameWithoutPageNumber = (pathname: string): string => {
  const pathOnly = pathname.split('?')[0] || '/'
  const hasTrailingSlash = pathOnly.length > 1 && pathOnly.endsWith('/')
  const segments = pathOnly.split('/').filter(Boolean)
  const { documentSegments, pageNumber } = parsePaginatedSlugSegments(segments)

  if (!pageNumber) {
    return pathOnly
  }

  const basePath = `/${documentSegments.join('/')}`
  const normalizedBasePath = basePath === '/' ? basePath : basePath.replace(/\/$/u, '')

  return hasTrailingSlash && normalizedBasePath !== '/'
    ? `${normalizedBasePath}/`
    : normalizedBasePath
}

/** `('/guides', 3)` → `/guides/page/3`; page 1 and below return the base path. */
export const getPathnameWithPageNumber = (basePathname: string, page: number): string => {
  const normalized = basePathname === '/' ? basePathname : basePathname.replace(/\/$/u, '')

  if (page <= 1) {
    return normalized
  }

  return `${normalized === '/' ? '' : normalized}/page/${page}`
}

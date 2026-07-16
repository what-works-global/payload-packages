import type { Payload } from 'payload'

import { devUser } from '@whatworks/dev-fixture/credentials'

export const seed = async (payload: Payload): Promise<void> => {
  const { totalDocs: users } = await payload.count({ collection: 'users' })
  if (users === 0) {
    await payload.create({ collection: 'users', data: devUser })
  }

  const { totalDocs: pages } = await payload.count({ collection: 'pages' })
  let aboutId: number | string | undefined
  if (pages === 0) {
    await payload.create({
      collection: 'pages',
      data: { slug: 'home', _status: 'published', title: 'Home' },
    })
    const about = await payload.create({
      collection: 'pages',
      data: { slug: 'about', _status: 'published', title: 'About' },
    })
    aboutId = about.id
  }

  const { totalDocs: redirects } = await payload.count({ collection: 'redirects' as never })
  if (redirects === 0) {
    if (aboutId) {
      // Internal reference with a scrollTo anchor — renaming the about page's
      // slug in the admin re-syncs this entry's destination automatically.
      await payload.create({
        collection: 'redirects' as never,
        data: {
          from: '/legacy-about',
          status: '301',
          to: {
            type: 'reference',
            reference: { relationTo: 'pages', value: aboutId },
            scrollTo: 'team',
          },
        } as never,
      })
    }
    await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/search-engine',
        status: '302',
        to: { type: 'custom', url: 'https://www.google.com' },
      } as never,
    })
    // Regex with a capture group: /posts/anything → /anything.
    await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '^/posts/(.+)$',
        matchType: 'regex',
        status: '302',
        to: { type: 'custom', url: '/$1' },
      } as never,
    })
    // Starts-with: any path under /section → /new-section (fixed destination).
    await payload.create({
      collection: 'redirects' as never,
      data: {
        from: '/section',
        matchType: 'startsWith',
        status: '301',
        to: { type: 'custom', url: '/new-section' },
      } as never,
    })
    // Case-insensitive exact match: /docs-legacy (any casing) → /docs.
    await payload.create({
      collection: 'redirects' as never,
      data: {
        caseInsensitive: true,
        from: '/Docs-Legacy',
        status: '301',
        to: { type: 'custom', url: '/docs' },
      } as never,
    })
    // Forward the incoming query string onto the destination.
    await payload.create({
      collection: 'redirects' as never,
      data: {
        forwardQuery: true,
        from: '/promo',
        status: '301',
        to: { type: 'custom', url: '/campaign' },
      } as never,
    })
    // Disabled: kept in the collection but excluded from the cache, so it never
    // fires (the frontend list shows it is absent).
    await payload.create({
      collection: 'redirects' as never,
      data: {
        enabled: false,
        from: '/disabled-redirect',
        status: '301',
        to: { type: 'custom', url: '/should-not-fire' },
      } as never,
    })
  }
}

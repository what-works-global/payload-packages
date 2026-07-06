import type { Payload } from 'payload'

import { devUser } from '@whatworks/dev-fixture/credentials'

export const seed = async (payload: Payload): Promise<void> => {
  const { totalDocs: users } = await payload.count({ collection: 'users' })
  if (users === 0) {
    await payload.create({ collection: 'users', data: devUser })
  }

  const { totalDocs: pages } = await payload.count({ collection: 'pages' })
  if (pages === 0) {
    await payload.create({
      collection: 'pages',
      data: { slug: 'home', _status: 'published', title: 'Home' },
    })
    await payload.create({
      collection: 'pages',
      data: { slug: 'about', _status: 'published', title: 'About' },
    })
    await payload.create({
      collection: 'pages',
      data: { slug: 'draft-only', _status: 'draft', title: 'Draft only (not in sitemap)' },
    })
    await payload.create({
      collection: 'pages',
      data: {
        slug: 'hidden',
        _status: 'published',
        excludeFromSitemap: true,
        title: 'Hidden (excluded from sitemap)',
      },
    })
  }

  const { totalDocs: legal } = await payload.count({ collection: 'legal' })
  if (legal === 0) {
    await payload.create({
      collection: 'legal',
      data: { slug: 'privacy', title: 'Privacy policy' },
    })
    await payload.create({
      collection: 'legal',
      data: { slug: 'terms', title: 'Terms of service' },
    })
  }
}

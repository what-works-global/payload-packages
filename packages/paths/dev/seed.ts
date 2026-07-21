import type { Payload } from 'payload'

/** Seed a small page tree the first time the dev sandbox boots. */
export const seed = async (payload: Payload): Promise<void> => {
  const existing = await payload.count({ collection: 'pages' })
  if (existing.totalDocs > 0) {
    return
  }

  const published = { _status: 'published' as const }

  await payload.create({
    collection: 'pages',
    data: { ...published, slug: 'home', title: 'Home' },
  })

  const about = await payload.create({
    collection: 'pages',
    data: { ...published, slug: 'about', title: 'About' },
  })

  // Nested /about/contact — coexists with a root /contact thanks to per-path
  // (not per-slug) uniqueness.
  await payload.create({
    collection: 'pages',
    data: { ...published, slug: 'contact', parent: about.id, title: 'Contact (About)' },
  })
  await payload.create({
    collection: 'pages',
    data: { ...published, slug: 'contact', title: 'Contact (root)' },
  })

  await payload.create({
    collection: 'posts',
    data: { ...published, slug: 'home', title: 'Blog home' },
  })
  await payload.create({
    collection: 'posts',
    data: { ...published, slug: 'hello-world', title: 'Hello world' },
  })

  const guides = await payload.create({
    collection: 'docs',
    data: { ...published, slug: 'guides', title: 'Guides' },
  })
  await payload.create({
    collection: 'docs',
    data: { ...published, slug: 'getting-started', parent: guides.id, title: 'Getting started' },
  })

  payload.logger.info('[payload-paths dev] Seeded pages, posts, and docs.')
}

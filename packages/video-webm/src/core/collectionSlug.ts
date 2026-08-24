import type { CollectionSlug } from 'payload'

/**
 * The plugin handles collection slugs dynamically, but applications with generated
 * types narrow Payload's `CollectionSlug` to their literal slug union — which a
 * library cannot know at compile time. Inside this package's own compilation
 * `CollectionSlug` is plain `string`, making the assertion look redundant; it is
 * required when the package is type-checked against a consuming app (dev sandbox).
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
export const asCollectionSlug = (slug: string): CollectionSlug => slug as CollectionSlug

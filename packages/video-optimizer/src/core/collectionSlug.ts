import type { CollectionSlug, TaskConfig } from 'payload'

/**
 * The plugin handles collection and task slugs dynamically, but applications with
 * generated types narrow Payload's `CollectionSlug` / task types to their literal
 * unions — which a library cannot know at compile time. Inside this package's own
 * compilation these are plain `string`, making the assertions look redundant; they
 * are required when the package is type-checked against a consuming app (dev
 * sandbox).
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
export const asCollectionSlug = (slug: string): CollectionSlug => slug as CollectionSlug

/** See {@link asCollectionSlug} — same story for job task slugs. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
export const asTaskSlug = (slug: string): TaskConfig['slug'] => slug as TaskConfig['slug']

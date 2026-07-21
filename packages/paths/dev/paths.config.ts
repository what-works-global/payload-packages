import { definePathsConfig } from '@whatworks/payload-paths'

/**
 * Shared paths config: spread into both the plugin (payload.config.ts) and the
 * frontend resolver ([[...slug]]/page.tsx) so prefixes and home slugs never
 * drift. This is the single source of truth for where each collection lives.
 */
export const pathsConfig = definePathsConfig({
  collections: {
    docs: { prefix: '/docs', strategy: 'parent' },
    pages: {},
    posts: { prefix: '/blog' },
  },
})

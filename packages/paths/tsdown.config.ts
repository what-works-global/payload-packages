import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: [
    'src/index.ts',
    'src/exports/cache.ts',
    'src/exports/next.ts',
    'src/exports/next-plugin.ts',
    'src/exports/resolver.ts',
  ],
  // One file per source module (no bundling) so the `/next` entry's `next/*`
  // imports never leak into the core or resolver entries' module graphs.
  unbundle: true,
})

import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: [
    'src/index.ts',
    'src/exports/cache.ts',
    'src/exports/client.ts',
    'src/exports/edge-config.ts',
    'src/exports/middleware.ts',
    'src/exports/resolver.ts',
    'src/exports/rsc.ts',
    'src/exports/vercel.ts',
  ],
  // Emit one file per source module (no bundling) so the rsc export's server
  // component and the client export's `'use client'` components keep their module
  // boundaries intact for the admin import map.
  unbundle: true,
})

import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/client.ts', 'src/exports/react.ts', 'src/exports/rsc.ts'],
  // Emit one file per source module (no bundling) so the client export's
  // components keep their `'use client'` directives for the import map.
  unbundle: true,
})

import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/rsc.ts'],
  // Emit one file per source module (no bundling) so the rsc export's server
  // components keep their module boundaries intact for the import map.
  unbundle: true,
})

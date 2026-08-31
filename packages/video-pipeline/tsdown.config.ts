import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/client.ts'],
  // Emit one file per source module (no bundling) so the client export's
  // 'use client' directive survives the build for the host app's bundler.
  unbundle: true,
})

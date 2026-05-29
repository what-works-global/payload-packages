import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/client.ts'],
  styles: true,
  // The client export's components carry `'use client'` directives. Bundling collapses
  // them into directive-less chunks, so they run on the server and throw. Emit one file
  // per source module to keep each `'use client'` directive intact.
  unbundle: true,
})

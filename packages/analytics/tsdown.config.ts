import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  copy: [{ flatten: false, from: 'src/**/*.md', to: 'dist' }],
  entry: ['src/index.ts', 'src/api/consent.ts'],
  // `Analytics` is a server component that composes nine `'use client'` components.
  // Bundling collapses them into one directive-less module, so the client components
  // run on the server and break. Emit one file per source module to keep each
  // `'use client'` directive intact.
  unbundle: true,
})

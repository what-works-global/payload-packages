import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/client.ts'],
  styles: true,
  // The client export mixes async server components (AdminButton, DangerBar,
  // SwitchDbConnectionView) with `'use client'` components they render. Bundling
  // would collapse them into one module and destroy the RSC boundary, so emit
  // one file per source module to keep each `'use client'` directive intact.
  unbundle: true,
})

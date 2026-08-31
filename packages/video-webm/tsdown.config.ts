import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: [
    'src/index.ts',
    'src/exports/frontend.ts',
    'src/exports/client.ts',
    // Dev-time only: measures a slot in a real browser to generate `sizes`. Kept a
    // separate entry so nothing an app bundles can reach Playwright through it.
    'src/exports/sizesDevtools.ts',
    'src/bin/sizes.ts',
  ],
  // The ./client entry ships a 'use client' component — per-module output keeps
  // the directive on its own chunk (enforced by check-use-client).
  unbundle: true,
})

import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/frontend.ts', 'src/exports/client.ts'],
  // The ./client entry ships a 'use client' component — per-module output keeps
  // the directive on its own chunk (enforced by check-use-client).
  unbundle: true,
})

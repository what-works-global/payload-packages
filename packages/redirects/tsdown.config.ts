import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: [
    'src/index.ts',
    'src/exports/cache.ts',
    'src/exports/edge-config.ts',
    'src/exports/middleware.ts',
    'src/exports/vercel.ts',
  ],
})

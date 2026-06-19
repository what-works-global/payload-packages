import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  copy: [{ flatten: false, from: 'src/**/*.md', to: 'dist' }],
  entry: [
    'src/index.ts',
    'src/entries/google.ts',
    'src/entries/linkedin.ts',
    'src/entries/clarity.ts',
    'src/entries/facebook.ts',
    'src/entries/posthog.ts',
    'src/api/consent.ts',
  ],
  // The package ships many `'use client'` components, now split across several
  // entry points. Bundling would collapse them into directive-less modules, so the
  // client components would run on the server and break. Emit one file per source
  // module to keep each `'use client'` directive intact.
  unbundle: true,
})

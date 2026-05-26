import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  copy: [{ flatten: false, from: 'src/**/*.md', to: 'dist' }],
  entry: ['src/index.ts', 'src/api/consent.ts'],
})

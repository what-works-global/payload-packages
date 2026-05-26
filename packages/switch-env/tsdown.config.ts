import { definePackageBuild } from '@whatworks/dev-fixture/tsdown-config'

export default definePackageBuild({
  entry: ['src/index.ts', 'src/exports/client.ts'],
  styles: true,
})

import { defineDevNextConfig } from '@whatworks/dev-fixture/next-config'

export default defineDevNextConfig({
  serverExternalPackages: ['mongodb-memory-server'],
})

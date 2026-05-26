import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      PAYLOAD_FORCE_DRIZZLE_PUSH: 'true',
    },
  },
})

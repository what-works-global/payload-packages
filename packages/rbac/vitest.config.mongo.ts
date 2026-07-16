import { defineConfig } from 'vitest/config'

// Real-MongoDB (in-memory replica set) integration tests. Kept separate from the
// mocked `test:peer` suite so the CI peer matrix stays fast and offline. Run with
// `pnpm --filter @whatworks/payload-rbac test:mongo`.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ['test/mongo/**/*.spec.ts'],
    testTimeout: 120_000,
  },
})

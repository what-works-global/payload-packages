import type { Config } from 'payload'

// Spread into every test `buildConfig` call. Disables Payload's autoGenerate
// hook, which otherwise spawns a detached `generate:types` subprocess on each
// init and leaks orphaned node processes across test runs.
export const sharedConfigDefaults: Partial<Config> = {
  typescript: { autoGenerate: false },
}

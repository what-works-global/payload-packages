import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { switchEnvPlugin } from '../../src/index.js'
import { getEnv } from '../../src/lib/env.js'
import { buildSharedCollections, buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

const makePluginConfig = (devUrl: string, prodUrl: string) => {
  const developmentArgs = { client: { url: devUrl } }
  const productionArgs = { client: { url: prodUrl } }
  return buildConfig({
    ...sharedConfigDefaults,
    collections: buildSharedCollections(),
    db: sqliteAdapter(productionArgs),
    editor: lexicalEditor(),
    globals: buildSharedGlobals(),
    plugins: [
      switchEnvPlugin({
        buttonMode: 'switch',
        db: { developmentArgs, function: sqliteAdapter, productionArgs },
        developmentSafetyMode: false,
        payloadVersion: '3.84.1',
      }),
    ],
    secret: 'test-secret-do-not-use-in-prod',
  })
}

describe('sqlite fresh-db init', () => {
  let workDir: string
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-fresh-db-'))
  })
  afterAll(async () => {
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })
  // getEnv caches into a process-global; reset it so this test is hermetic.
  afterEach(() => {
    ;(globalThis as { env?: unknown }).env = undefined
  })

  // Regression: on a brand-new database whose schema has not been pushed by the
  // time `onInit` runs (e.g. a fresh remote libsql/Turso db, where drizzle's
  // dev schema-push does not create tables), the plugin's `onInit` used to crash
  // with "no such table: switch_env" because `getEnv(payload)` queried the global
  // before its table existed. It must instead treat the missing table as
  // "development" and let init complete.
  it('initializes without crashing when the switch_env table does not exist yet', async () => {
    // Gate off the dev schema push so the connection lands on a db with no tables.
    const prev = process.env.PAYLOAD_MIGRATING
    process.env.PAYLOAD_MIGRATING = 'true'
    let payload: BasePayload | undefined
    try {
      payload = await getPayload({
        config: Promise.resolve(
          makePluginConfig(
            `file:${join(workDir, 'dev.sqlite')}`,
            `file:${join(workDir, 'prod.sqlite')}`,
          ),
        ),
        key: 'switch-env-fresh-db',
      } as Parameters<typeof getPayload>[0])

      // A missing switch_env table means no persisted switch state ⇒ development.
      ;(globalThis as { env?: unknown }).env = undefined
      await expect(getEnv(payload)).resolves.toBe('development')
    } finally {
      await payload?.db.destroy?.()
      if (prev === undefined) {
        delete process.env.PAYLOAD_MIGRATING
      } else {
        process.env.PAYLOAD_MIGRATING = prev
      }
    }
  })
})

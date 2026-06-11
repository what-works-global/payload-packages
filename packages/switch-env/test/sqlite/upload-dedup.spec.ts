import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BasePayload, buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { switchEnvPlugin } from '../../src/index.js'
import { setEnvCache } from '../../src/lib/env.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

const makeFile = (name: string) => {
  const data = Buffer.from(`fake zip bytes for ${name}`)
  return { name, data, mimetype: 'application/zip', size: data.length }
}

interface UploadDoc {
  createdDuringDevelopment?: boolean
  developmentStorageMode?: null | string
  filename?: string
  prefix?: null | string
}

// Duplicate filenames on upload collections in development cloud-storage mode.
//
// Payload's duplicate-filename check (generateFileData -> getSafeFileName) runs
// before any beforeChange hook and filters its lookup by the incoming
// data.prefix, while the unique index on `filename` spans the whole collection.
// The admin form submits the prefix field's baked defaultValue (the original
// collection prefix), so unless the development prefix is applied before the
// operation starts, the check misses existing development docs and the insert
// trips the unique index ("The following field is invalid: filename").
describe('development cloud-storage uploads', () => {
  let workDir: string
  let payload: BasePayload | undefined

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-upload-dedup-'))
    const productionArgs = { client: { url: `file:${join(workDir, 'prod.sqlite')}` } }
    const developmentArgs = { client: { url: `file:${join(workDir, 'dev.sqlite')}` } }

    const config = await buildConfig({
      ...sharedConfigDefaults,
      collections: [
        {
          slug: 'privateMedia',
          fields: [
            // Mirrors the hidden prefix field that @payloadcms/plugin-cloud-storage
            // adds, including the defaultValue baked from the collection prefix.
            {
              name: 'prefix',
              type: 'text',
              admin: { hidden: true },
              defaultValue: 'private',
            },
          ],
          upload: true,
        },
      ],
      db: sqliteAdapter(productionArgs),
      plugins: [
        switchEnvPlugin({
          db: { developmentArgs, function: sqliteAdapter, productionArgs },
          developmentFileStorage: {
            collections: { privateMedia: { prefix: 'private' } },
            mode: 'cloud-storage',
            prefix: 'staging',
          },
          developmentSafetyMode: false,
          payloadVersion: '3.84.1',
        }),
      ],
      secret: 'test-secret-do-not-use-in-prod',
    })

    payload = await getPayload({
      config: Promise.resolve(config),
      key: 'switch-env-test-upload-dedup',
    } as Parameters<typeof getPayload>[0])
  })

  afterAll(async () => {
    await payload?.db.destroy?.()
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  const createUpload = (name: string, data: Record<string, unknown> = {}) =>
    payload!.create({
      collection: 'privateMedia',
      data,
      file: makeFile(name),
    }) as Promise<UploadDoc>

  it('applies the development prefix and flags on create', async () => {
    // The admin form submits the prefix field's baked defaultValue.
    const doc = await createUpload('alpha.zip', { prefix: 'private' })
    expect(doc.filename).toBe('alpha.zip')
    expect(doc.prefix).toBe('staging/private')
    expect(doc.createdDuringDevelopment).toBe(true)
    expect(doc.developmentStorageMode).toBe('cloud-storage')
  })

  it('dedupes a duplicate filename instead of tripping the unique filename index', async () => {
    const first = await createUpload('dup.zip', { prefix: 'private' })
    expect(first.filename).toBe('dup.zip')
    expect(first.prefix).toBe('staging/private')

    const second = await createUpload('dup.zip', { prefix: 'private' })
    expect(second.filename).toBe('dup-1.zip')
    expect(second.prefix).toBe('staging/private')
  })

  it('dedupes when the incoming data already carries the development prefix', async () => {
    const third = await createUpload('dup.zip', { prefix: 'staging/private' })
    expect(third.filename).toBe('dup-2.zip')
    expect(third.prefix).toBe('staging/private')
  })

  it('pins the rewritten collection prefix when no prefix is provided', async () => {
    const doc = await createUpload('no-prefix.zip')
    expect(doc.prefix).toBe('staging/private')
    expect(doc.createdDuringDevelopment).toBe(true)
  })

  // Filename uniqueness is scoped to (filename, prefix) via the
  // filenameCompoundIndex the plugin sets, so a production upload may reuse a
  // filename that development docs hold under the development prefix — they are
  // different storage keys — while duplicates within a prefix still deduplicate.
  describe('in the production environment', () => {
    beforeAll(() => {
      setEnvCache('production')
    })

    afterAll(() => {
      setEnvCache('development')
    })

    it('allows a filename held by development docs under another prefix', async () => {
      const doc = await createUpload('dup.zip', { prefix: 'private' })
      expect(doc.filename).toBe('dup.zip')
      expect(doc.prefix).toBe('private')
      expect(doc.createdDuringDevelopment).toBeFalsy()
    })

    it('dedupes duplicate filenames within the production prefix', async () => {
      const doc = await createUpload('dup.zip', { prefix: 'private' })
      expect(doc.filename).toBe('dup-1.zip')
      expect(doc.prefix).toBe('private')
    })
  })
})

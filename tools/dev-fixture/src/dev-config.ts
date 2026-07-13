import { mongooseAdapter } from '@payloadcms/db-mongodb'
import path from 'node:path'
import {
  buildConfig,
  type CollectionConfig,
  type Config,
  type Payload,
  type SanitizedConfig,
} from 'payload'

import { devUser } from './credentials.js'

export const devUsersCollection: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [],
}

/** Creates the shared autoLogin dev user unless a user already exists. */
export async function ensureDevUser(payload: Payload): Promise<void> {
  const existing = await payload.find({
    collection: 'users',
    limit: 1,
  })

  if (existing.docs.length === 0) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
  }
}

export type DevConfigOptions = {
  /**
   * Mongo database name for the default `mongodb://127.0.0.1:27017/<dbName>` fallback
   * (used when `DATABASE_URI` is unset). Required unless `db` is provided.
   */
  dbName?: string
  /** Absolute path of the dev app directory — pass `path.dirname(fileURLToPath(import.meta.url))`. */
  dirname: string
  /** Seed the dev user in `onInit`, ahead of the config's own `onInit`. Defaults to true. */
  seedDevUser?: boolean
} & Partial<Config>

/**
 * `buildConfig` wrapper for the packages' dev sandboxes. Fills in the boilerplate every
 * dev app repeats — autoLogin as the shared dev user, import map and generated types
 * rooted in the dev directory, a default `users` auth collection (skipped when the
 * caller defines its own), a local-Mongo fallback connection, dev-user seeding, and
 * disabled telemetry — while letting the caller override any of it through regular
 * Payload config keys.
 */
export function buildDevConfig(options: DevConfigOptions): Promise<SanitizedConfig> {
  const {
    admin,
    collections = [],
    db,
    dbName,
    dirname,
    onInit,
    secret,
    seedDevUser = true,
    typescript,
    ...rest
  } = options

  if (!db && !dbName) {
    throw new Error('buildDevConfig requires either `db` or `dbName`')
  }

  const hasUsersCollection = collections.some((collection) => collection.slug === 'users')

  return buildConfig({
    admin: {
      autoLogin: {
        email: devUser.email,
      },
      user: 'users',
      ...admin,
      importMap: {
        baseDir: path.resolve(dirname),
        ...admin?.importMap,
      },
    },
    collections: hasUsersCollection ? collections : [devUsersCollection, ...collections],
    db:
      db ??
      mongooseAdapter({
        url: process.env.DATABASE_URI || `mongodb://127.0.0.1:27017/${dbName}`,
      }),
    onInit: async (payload) => {
      if (seedDevUser) {
        await ensureDevUser(payload)
      }
      await onInit?.(payload)
    },
    secret: secret ?? (process.env.PAYLOAD_SECRET || 'dev-secret'),
    telemetry: false,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
      ...typescript,
    },
    ...rest,
  })
}

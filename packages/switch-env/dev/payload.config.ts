import { mongooseAdapter, type Args as MongoArgs } from '@payloadcms/db-mongodb'
import { sqliteAdapter, type SQLiteAdapterArgs as SqliteArgs } from '@payloadcms/db-sqlite'
import fs from 'fs'
import path from 'path'
import { type DatabaseAdapterObj } from 'payload'
import { fileURLToPath } from 'url'
import {
  switchEnvPlugin,
  adminThumbnail,
  type SwitchEnvPluginArgs,
} from '@whatworks/payload-switch-env'
import { s3Storage, type S3StorageOptions } from '@payloadcms/storage-s3'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { devUser } from '@whatworks/dev-fixture/credentials'
import sharp from 'sharp'
import { getS3SignedUrl } from './fileUtils'

const dirname = path.dirname(fileURLToPath(import.meta.url))

type DbAdapter = 'mongo' | 'sqlite'
const dbAdapter: DbAdapter = process.env.DB_ADAPTER === 'sqlite' ? 'sqlite' : 'mongo'

type DbBlock =
  | {
      adapter: 'mongo'
      db: DatabaseAdapterObj
      plugin: SwitchEnvPluginArgs<MongoArgs>['db']
    }
  | {
      adapter: 'sqlite'
      db: DatabaseAdapterObj
      plugin: SwitchEnvPluginArgs<SqliteArgs>['db']
    }

const buildDbBlock = (): DbBlock => {
  if (dbAdapter === 'sqlite') {
    const sqliteDir = path.resolve(dirname, '../.dbs')
    fs.mkdirSync(sqliteDir, { recursive: true })
    const productionArgs: SqliteArgs = {
      client: {
        url: process.env.PRODUCTION_SQLITE_URL || `file:${path.join(sqliteDir, 'production.db')}`,
        authToken: process.env.PRODUCTION_SQLITE_AUTH_TOKEN,
      },
      push: true,
    }
    const developmentArgs: SqliteArgs = {
      client: {
        url: process.env.DEVELOPMENT_SQLITE_URL || `file:${path.join(sqliteDir, 'development.db')}`,
        authToken: process.env.DEVELOPMENT_SQLITE_AUTH_TOKEN,
      },
    }
    return {
      adapter: 'sqlite',
      db: sqliteAdapter(productionArgs),
      plugin: { function: sqliteAdapter, productionArgs, developmentArgs },
    }
  }

  const productionArgs: MongoArgs = { url: process.env.PRODUCTION_MONGODB_URI! }
  const developmentArgs: MongoArgs = {
    ...productionArgs,
    url: process.env.DEVELOPMENT_MONGODB_URI || '',
  }
  return {
    adapter: 'mongo',
    db: mongooseAdapter(productionArgs),
    plugin: { function: mongooseAdapter, productionArgs, developmentArgs },
  }
}

const dbBlock = buildDbBlock()

const isDev = process.env.NODE_ENV === 'development'
const adminEmail = process.env.ADMIN_EMAIL
const s3StorageCollections: S3StorageOptions['collections'] = {
  privateMedia: {
    prefix: 'private',
    disablePayloadAccessControl: true,
    generateFileURL: async ({ filename, prefix }) => await getS3SignedUrl(`${prefix}/${filename}`),
  },
  media: {
    prefix: 'public',
    disablePayloadAccessControl: true,
    generateFileURL: ({ filename, prefix }) => {
      const result = `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com/${prefix}/${filename}`
      return result
    },
  },
}

export default buildDevConfig({
  admin: {
    autoLogin: Boolean(isDev && adminEmail) && {
      email: adminEmail,
    },
  },
  collections: [
    {
      slug: 'pages',
      versions: {
        drafts: true,
      },
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
      ],
    },
    {
      // Mirrors a real consumer setup (zip-restricted upload collection with an S3
      // prefix) — `mimeTypes` is required to exercise checkFileRestrictions' buffer
      // sniffing, which is where the cloud-storage prefix desync surfaces.
      slug: 'privateMedia',
      fields: [],
      upload: {
        mimeTypes: [
          'text/csv',
          'application/zip',
          'application/x-zip-compressed',
          'application/gzip',
        ],
      },
    },
    {
      slug: 'media',
      fields: [
        {
          name: 'text',
          type: 'text',
        },
      ],
      upload: {
        adminThumbnail: adminThumbnail({
          basePath: `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`,
          imageSize: 'thumbnail',
        }),
        imageSizes: [
          {
            name: 'thumbnail',
            width: 300,
            height: 300,
          },
        ],
      },
    },
  ],
  db: dbBlock.db,
  dirname,
  globals: [
    {
      slug: 'versionedGlobal',
      versions: {
        drafts: true,
      },
      fields: [
        {
          name: 'test',
          type: 'text',
        },
      ],
    },
  ],
  logger: {
    options: {
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    },
  },
  // Seeds `ADMIN_EMAIL` when set (matching the conditional autoLogin above), so the
  // default dev-user seeding is disabled in favor of this.
  onInit: async (payload) => {
    const existingUsers = await payload.find({
      collection: 'users',
      limit: 1,
    })

    if (existingUsers.docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: {
          ...devUser,
          email: adminEmail ?? devUser.email,
        },
      })
    }
  },
  plugins: [
    s3Storage({
      bucket: process.env.S3_BUCKET!,
      collections: s3StorageCollections,
      clientUploads: true,
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        region: process.env.S3_REGION,
      },
    }),
    switchEnvPlugin({
      // sqlite dev URLs are `file:./...` which don't contain localhost
      developmentSafetyMode: dbBlock.adapter !== 'sqlite',
      db: dbBlock.plugin as SwitchEnvPluginArgs<MongoArgs | SqliteArgs>['db'],
      buttonMode: 'switch',
      developmentFileStorage:
        process.env.APP_ENV === 'staging'
          ? {
              mode: 'cloud-storage',
              prefix: 'staging',
              collections: s3StorageCollections,
            }
          : {
              mode: 'file-system',
            },
      copy: {
        versions: {
          default: {
            mode: 'none',
          },
        },
      },
    }),
  ],
  // The custom onInit above seeds `ADMIN_EMAIL` when set (matching the conditional
  // autoLogin), so the default dev-user seeding is disabled.
  seedDevUser: false,
  sharp,
})

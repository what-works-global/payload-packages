import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import {
  relationshipTitleResolver,
  transformDocument,
} from '@whatworks/payload-utilities/traverseDocument'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { devUser } from './helpers/credentials.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 3,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URI = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      autoLogin: {
        email: devUser.email,
      },
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'posts',
        admin: {
          useAsTitle: 'title',
        },
        fields: [
          {
            name: 'title',
            type: 'text',
          },
          {
            name: 'nonPolymorphicSingle',
            type: 'relationship',
            hasMany: false,
            relationTo: 'posts',
          },
          {
            name: 'nonPolymorphicMany',
            type: 'relationship',
            hasMany: true,
            relationTo: 'posts',
          },
          {
            name: 'polymorphicSingle',
            type: 'relationship',
            hasMany: false,
            relationTo: ['posts', 'media'],
          },
          {
            name: 'polymorphicMany',
            type: 'relationship',
            hasMany: true,
            relationTo: ['posts', 'media'],
          },
          {
            name: 'uploads',
            type: 'upload',
            hasMany: false,
            relationTo: 'media',
          },
        ],
        hooks: {
          afterChange: [
            async (args) => {
              const result = await transformDocument({
                collection: args.collection,
                doc: args.doc,
                fieldResolvers: {
                  relationship: relationshipTitleResolver,
                },
                req: args.req,
              })
              console.dir(result, { depth: null })
            },
          ],
        },
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'uploads', 'media'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URI || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()

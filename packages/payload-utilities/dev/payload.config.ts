import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import {
  defaultFieldResolvers,
  flattenDocumentValues,
  relationshipTitleResolver,
} from '@whatworks/payload-utilities/flattenDocumentValues'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { flattenDocumentValuesV2 } from '../src/flattenDocumentValues/flattenDocumentValuesV2.js'
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
            name: 'someGroup',
            type: 'group',
            fields: [
              {
                name: 'groupTextField',
                type: 'text',
              },
            ],
          },
          {
            name: 'someArray',
            type: 'array',
            fields: [
              {
                name: 'arrayTextField',
                type: 'text',
              },
            ],
          },
          {
            name: 'author',
            type: 'relationship',
            relationTo: 'posts',
          },
          {
            name: 'uploads',
            type: 'upload',
            hasMany: false,
            relationTo: 'media',
          },
          {
            name: 'richText',
            type: 'richText',
          },
        ],
        hooks: {
          afterChange: [
            (args) => {
              const result = flattenDocumentValuesV2({
                collection: args.collection,
                doc: args.doc,
                req: args.req,
              })
              console.log(
                result.map((f) => ({
                  label: f.schemaPathSegments.map((s) => s.label).join(' > '),
                  value: f.value,
                })),
              )
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

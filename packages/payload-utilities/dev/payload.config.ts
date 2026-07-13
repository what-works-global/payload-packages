import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildDevConfig } from '@whatworks/dev-fixture/dev-config'
import { startMemoryMongo } from '@whatworks/dev-fixture/memory-db'
import { testEmailAdapter } from '@whatworks/dev-fixture/test-email'
import {
  relationshipTitleResolver,
  transformDocument,
} from '@whatworks/payload-utilities/traverseDocument'
import path from 'path'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { seed } from './seed.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    await startMemoryMongo({ dbName: 'payloadmemory' })
  }

  return buildDevConfig({
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
    dirname,
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: seed,
    sharp,
  })
}

export default buildConfigWithMemoryDB()

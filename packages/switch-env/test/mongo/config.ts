import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { buildSharedCollections, buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

export interface MakeMongoConfigArgs {
  dbUrl: string
  secret?: string
}

export const makeMongoConfig = ({
  dbUrl,
  secret = 'test-secret-do-not-use-in-prod',
}: MakeMongoConfigArgs) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: buildSharedCollections(),
    db: mongooseAdapter({
      url: dbUrl,
    }),
    editor: lexicalEditor(),
    globals: buildSharedGlobals(),
    secret,
  })

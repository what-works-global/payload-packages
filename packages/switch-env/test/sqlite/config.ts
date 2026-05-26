import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { buildSharedCollections, buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

export interface MakeSqliteConfigArgs {
  dbUrl: string
  secret?: string
}

export const makeSqliteConfig = ({
  dbUrl,
  secret = 'test-secret-do-not-use-in-prod',
}: MakeSqliteConfigArgs) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: buildSharedCollections(),
    db: sqliteAdapter({
      client: { url: dbUrl },
    }),
    editor: lexicalEditor(),
    globals: buildSharedGlobals(),
    secret,
  })

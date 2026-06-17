import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { buildSharedCollections, buildSharedGlobals } from '../shared/collections.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

export interface MakePostgresConfigArgs {
  connectionString: string
  secret?: string
}

export const makePostgresConfig = ({
  connectionString,
  secret = 'test-secret-do-not-use-in-prod',
}: MakePostgresConfigArgs) =>
  buildConfig({
    ...sharedConfigDefaults,
    collections: buildSharedCollections(),
    db: postgresAdapter({
      pool: { connectionString },
    }),
    editor: lexicalEditor(),
    globals: buildSharedGlobals(),
    secret,
  })

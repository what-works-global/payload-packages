import { MongoMemoryServer } from 'mongodb-memory-server'
import { getPayload } from 'payload'

import {
  normalizeCopyConfig,
  resolvePayloadCollectionScopes,
  resolveVersionCollectionModes,
} from '../../src/lib/copyUtils.js'
import { backup, restore } from '../../src/lib/db/mongo.js'
import { runCopyScenarios } from '../shared/copyScenarios.js'
import { makeMongoConfig } from './config.js'

runCopyScenarios({
  name: 'mongo',
  copy: async (source, target, { copyConfig }) => {
    const resolved = normalizeCopyConfig({ copy: copyConfig })
    const payloadCollectionScopes = resolvePayloadCollectionScopes({
      copy: resolved,
      payload: source,
    })
    const versionCollectionModes = resolveVersionCollectionModes({
      copy: resolved,
      payload: source,
    })
    const backupData = await backup(source.db.connection, {
      payloadCollectionScopes,
      versionCollectionModes,
    })
    await restore(target.db.connection, backupData, target.logger)
  },
  setupPayloads: async () => {
    const server = await MongoMemoryServer.create()
    const baseUri = server.getUri()
    const sourceUri = `${baseUri}source`
    const targetUri = `${baseUri}target`

    const sourceConfig = await makeMongoConfig({ dbUrl: sourceUri })
    const targetConfig = await makeMongoConfig({ dbUrl: targetUri })

    const sourcePayload = await getPayload({
      config: Promise.resolve(sourceConfig),
      key: 'switch-env-test-mongo-source',
    } as Parameters<typeof getPayload>[0])
    const targetPayload = await getPayload({
      config: Promise.resolve(targetConfig),
      key: 'switch-env-test-mongo-target',
    } as Parameters<typeof getPayload>[0])

    return {
      cleanup: async () => {
        await sourcePayload.db.destroy?.()
        await targetPayload.db.destroy?.()
        await server.stop()
      },
      sourcePayload,
      targetPayload,
    }
  },
})

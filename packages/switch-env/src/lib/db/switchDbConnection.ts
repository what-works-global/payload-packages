import { type DatabaseAdapter, type Payload } from 'payload'

import type { Env } from '../../types.js'
import type { GetDatabaseAdapter } from './getDbaFunction.js'

const describeConnection = (db: Payload['db']): string => {
  const connectionName = (db as unknown as { connection?: { name?: string } }).connection?.name
  return connectionName ?? db.name
}

export const switchDbConnection = async (
  payload: Payload,
  newEnv: Env,
  getDatabaseAdapter: GetDatabaseAdapter,
) => {
  const oldDatabaseName = describeConnection(payload.db)

  if (typeof payload.db.destroy === 'function') {
    await payload.db.destroy()
  }

  const newDb = getDatabaseAdapter(newEnv).init({ payload })
  payload.db = newDb as unknown as DatabaseAdapter
  payload.db.payload = payload

  if (payload.db.init) {
    await payload.db.init()
  }

  // pushDevSchema (drizzle) caches the previous schema at module scope, so the
  // second connect in a process is a no-op when schemas match. That leaves the
  // destination DB empty when both envs share a schema (the common case).
  // Force-push during the switch's connect so the target gets initialised.
  const previousForce = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
  try {
    if (payload.db.connect) {
      await payload.db.connect()
    }
  } finally {
    if (previousForce === undefined) {
      delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH
    } else {
      process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = previousForce
    }
  }

  const newDatabaseName = describeConnection(payload.db)

  payload.logger.debug(`Switched from ${oldDatabaseName} to ${newDatabaseName}`)
}

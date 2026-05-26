import type { BasePayload, DatabaseAdapter } from 'payload'

import type { Env } from '../../types.js'
import type { GetDatabaseAdapter } from './getDbaFunction.js'

/**
 * Initializes a secondary database adapter alongside the main `payload.db`
 * adapter. Used by the SQL copy flow to read from the source database while
 * the primary `payload.db` continues to point at the target.
 *
 * Push is force-disabled on the returned adapter so this temporary connection
 * never mutates the source database's schema.
 */
export const openAdapter = async (
  payload: BasePayload,
  env: Env,
  getDatabaseAdapter: GetDatabaseAdapter,
): Promise<DatabaseAdapter> => {
  const adapterObj = getDatabaseAdapter(env)
  const adapter = adapterObj.init({ payload }) as unknown as DatabaseAdapter
  ;(adapter as unknown as { push?: boolean }).push = false
  if (typeof adapter.init === 'function') {
    await adapter.init()
  }
  if (typeof adapter.connect === 'function') {
    await adapter.connect()
  }
  return adapter
}

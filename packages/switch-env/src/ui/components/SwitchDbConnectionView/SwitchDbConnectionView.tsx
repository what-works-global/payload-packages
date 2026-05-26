import type { AdminViewServerProps } from 'payload'
import type { FC } from 'react'

import { redirect } from 'next/navigation'

import type { GetDatabaseAdapter } from '../../../lib/db/getDbaFunction.js'

import { switchDbConnection } from '../../../lib/db/switchDbConnection.js'
import { setEnvCache } from '../../../lib/env.js'

export type SwitchDbConnectionViewProps = {
  getDatabaseAdapter: GetDatabaseAdapter
} & AdminViewServerProps

const isEnv = (env: string | string[] | undefined): env is 'development' | 'production' => {
  return typeof env === 'string' && (env === 'production' || env === 'development')
}

export const SwitchDbConnectionView: FC<SwitchDbConnectionViewProps> = async ({
  getDatabaseAdapter,
  payload,
  searchParams,
}) => {
  if (!searchParams || !searchParams.secret || searchParams.secret !== payload.config.secret) {
    payload.logger.error(
      `Invalid secret '${String(searchParams?.secret)}' in SwitchDbConnectionView`,
    )
    // If not authorized, redirect to /admin (Payload's default behaviour if route does not exist)
    redirect(payload.config.routes.admin)
  }
  const env = searchParams.env
  if (!isEnv(env)) {
    const errorMsg = `Query parameter 'env' has invalid value '${String(env)}' in SwitchDbConnectionView`
    payload.logger.error(errorMsg)
    return <p>{errorMsg}</p>
  }
  setEnvCache(env)
  await switchDbConnection(payload, env, getDatabaseAdapter)
  return <p>Successfully connected to {env} database</p>
}

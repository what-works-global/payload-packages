import type { Endpoint, PayloadRequest } from 'payload'

import { formatAdminURL } from 'payload/shared'

import type { DevelopmentFileStorageArgs, GetEnv, SetEnv } from '../../types.js'
import type { GetDatabaseAdapter } from '../db/getDbaFunction.js'

import { switchEnvironments } from '../collectionConfig.js'
import {
  type ResolvedCopyConfig,
  resolvePayloadCollectionScopes,
  resolveVersionCollectionModes,
} from '../copyUtils.js'
import { backup, type BackupData, restore } from '../db/mongo.js'
import { backupSql, restoreSql, type SqlBackupData } from '../db/sql.js'
import { switchDbConnection } from '../db/switchDbConnection.js'
import { formatFileSize, getServerUrl } from '../utils.js'

export interface SwitchEndpointInput {
  copyDatabase: boolean
}

export interface SwitchEndpointOutput {
  message: string
  success: boolean
}

export interface SwitchEndpointArgs {
  copy: ResolvedCopyConfig
  developmentFileStorage: DevelopmentFileStorageArgs
  getDatabaseAdapter: GetDatabaseAdapter
  getEnv: GetEnv
  logDatabaseSize: boolean
  payloadVersion: string
  setEnv: SetEnv
}

export const switchEndpoint = ({
  copy,
  developmentFileStorage,
  getDatabaseAdapter,
  getEnv,
  logDatabaseSize,
  payloadVersion,
  setEnv,
}: SwitchEndpointArgs): Endpoint => ({
  handler: async (req: PayloadRequest) => {
    const payload = req.payload
    const logger = payload.logger
    const env = await getEnv(payload)
    const adapterName = payload.db.name
    let mongoBackup: BackupData | null = null
    let sqlBackup: null | SqlBackupData = null

    if (env === 'production' && req.json) {
      const body = (await req.json()) as SwitchEndpointInput
      if (body.copyDatabase) {
        if (adapterName === 'mongoose') {
          const payloadCollectionScopes = resolvePayloadCollectionScopes({ copy, payload })
          const versionCollectionModes = resolveVersionCollectionModes({ copy, payload })
          mongoBackup = await backup(payload.db.connection, {
            payloadCollectionScopes,
            versionCollectionModes,
          })
          const databaseSize = logDatabaseSize
            ? formatFileSize(JSON.stringify(mongoBackup).length)
            : null
          logger.info(
            `Created backup of production database${databaseSize ? ` (${databaseSize})` : ''}`,
          )
        } else if (adapterName === 'sqlite' || adapterName === 'postgres') {
          sqlBackup = await backupSql({
            copyConfig: copy,
            payload,
            sourceAdapter: payload.db,
          })
          const databaseSize = logDatabaseSize
            ? formatFileSize(JSON.stringify(sqlBackup).length)
            : null
          logger.info(
            `Created backup of production database${databaseSize ? ` (${databaseSize})` : ''}`,
          )
        } else {
          throw new Error(`switch-env: unsupported db adapter "${adapterName}"`)
        }
      }
    }

    const newEnv = env === 'production' ? 'development' : 'production'

    if (env === 'development') {
      await setEnv(newEnv, payload)
    }

    await switchDbConnection(payload, newEnv, getDatabaseAdapter)

    if (mongoBackup) {
      logger.info('Restoring production database backup to local')
      await restore(payload.db.connection, mongoBackup, payload.logger)
    }

    if (sqlBackup) {
      logger.info('Restoring production database backup to local')
      await restoreSql({
        backupData: sqlBackup,
        logger,
        payload,
        targetAdapter: payload.db,
      })
    }

    if (newEnv === 'development') {
      await setEnv(newEnv, payload)
    }

    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      const serverUrl = getServerUrl(req)
      const adminRoute = payload.config.routes.admin
      const searchParams = new URLSearchParams()
      searchParams.set('env', newEnv)
      searchParams.set('secret', payload.config.secret)
      const queryString = searchParams.toString()
      // formatAdminURL prepends a Next.js `basePath` (process.env.NEXT_BASE_PATH) when set.
      const switchDbConnectionUrl = formatAdminURL({
        adminRoute,
        path: '/switch-db-connection',
        serverURL: serverUrl,
      })
      await fetch(`${switchDbConnectionUrl}?${queryString}`)
    }

    switchEnvironments(payload.config, newEnv, developmentFileStorage, payloadVersion)

    logger.info('Switched to ' + newEnv + ' environment')

    const res: SwitchEndpointOutput = {
      message: 'Switched to ' + newEnv,
      success: true,
    }
    return Response.json(res)
  },
  method: 'post',
  path: '/switch-env',
})

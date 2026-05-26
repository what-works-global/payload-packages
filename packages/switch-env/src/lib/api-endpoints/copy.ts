import type { Endpoint, PayloadRequest } from 'payload'

import type { GetEnv } from '../../types.js'
import type { GetDatabaseAdapter } from '../db/getDbaFunction.js'

import {
  type ResolvedCopyConfig,
  resolvePayloadCollectionScopes,
  resolveVersionCollectionModes,
} from '../copyUtils.js'
import { backup, restore } from '../db/mongo.js'
import { openAdapter } from '../db/openAdapter.js'
import { backupSql, restoreSql } from '../db/sql.js'
import { switchDbConnection } from '../db/switchDbConnection.js'
import { formatFileSize } from '../utils.js'

export interface CopyEndpointInput {
  // No parameters needed - always copies from production to development
}

export interface CopyEndpointOutput {
  message: string
  success: boolean
}

export interface CopyEndpointArgs {
  copy: ResolvedCopyConfig
  getDatabaseAdapter: GetDatabaseAdapter
  getEnv: GetEnv
  logDatabaseSize: boolean
}

export const copyEndpoint = ({
  copy,
  getDatabaseAdapter,
  getEnv,
  logDatabaseSize,
}: CopyEndpointArgs): Endpoint => ({
  handler: async (req: PayloadRequest) => {
    const payload = req.payload
    const logger = payload.logger
    const currentEnv = await getEnv(payload)

    if (currentEnv !== 'development') {
      return Response.json({
        message: 'This endpoint can only be used from development environment',
        success: false,
      } as CopyEndpointOutput)
    }

    try {
      const adapterName = payload.db.name

      if (adapterName === 'mongoose') {
        logger.debug(`Switching db connection to production environment`)
        await switchDbConnection(payload, 'production', getDatabaseAdapter)

        logger.debug(`Creating backup from production environment`)
        const payloadCollectionScopes = resolvePayloadCollectionScopes({ copy, payload })
        const versionCollectionModes = resolveVersionCollectionModes({ copy, payload })
        const backupData = await backup(payload.db.connection, {
          payloadCollectionScopes,
          versionCollectionModes,
        })

        const databaseSize = logDatabaseSize
          ? formatFileSize(JSON.stringify(backupData).length)
          : null
        logger.info(
          `Created backup from production database${databaseSize ? ` (${databaseSize})` : ''}`,
        )

        logger.debug(`Switching db connection to development environment`)
        await switchDbConnection(payload, 'development', getDatabaseAdapter)

        logger.debug(`Restoring production database backup to development environment`)
        await restore(payload.db.connection, backupData, logger)
      } else if (adapterName === 'sqlite' || adapterName === 'postgres') {
        logger.debug(`Opening secondary adapter against production (${adapterName})`)
        const sourceAdapter = await openAdapter(payload, 'production', getDatabaseAdapter)
        try {
          logger.debug(`Creating backup from production environment`)
          const backupData = await backupSql({
            copyConfig: copy,
            payload,
            sourceAdapter,
          })

          const databaseSize = logDatabaseSize
            ? formatFileSize(JSON.stringify(backupData).length)
            : null
          logger.info(
            `Created backup from production database${databaseSize ? ` (${databaseSize})` : ''}`,
          )

          logger.debug(`Restoring production backup to development target`)
          await restoreSql({
            backupData,
            logger,
            payload,
            targetAdapter: payload.db,
          })
        } finally {
          if (typeof sourceAdapter.destroy === 'function') {
            await sourceAdapter.destroy()
          }
        }
      } else {
        throw new Error(`switch-env: unsupported db adapter "${adapterName}"`)
      }

      logger.info(`Successfully copied production database to development environment`)

      const res: CopyEndpointOutput = {
        message: `Successfully copied production database to development`,
        success: true,
      }
      return Response.json(res)
    } catch (error) {
      logger.error(error, `Failed to copy database from production to development`)
      return Response.json({
        message: `Failed to copy database: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        success: false,
      } as CopyEndpointOutput)
    }
  },
  method: 'post',
  path: '/copy-db',
})

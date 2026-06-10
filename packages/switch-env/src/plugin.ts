// This import is required for the connection object to be typed on the payload.db object
import type { MongooseAdapter as _MongooseAdapter } from '@payloadcms/db-mongodb'

import { type Plugin } from 'payload'

import type { SwitchEnvPluginArgs } from './types.js'

import { switchEnvGlobal } from './globals/switchEnvGlobal.js'
import { copyEndpoint } from './lib/api-endpoints/copy.js'
import { switchEndpoint } from './lib/api-endpoints/switch.js'
import {
  addAccessSettingsToUploadCollection,
  addDevelopmentSettingsToUploadCollection,
  modifyThumbnailUrl,
  switchEnvironments,
  wrapClientUploadEndpoints,
} from './lib/collectionConfig.js'
import { normalizeCopyConfig, warnOnInvalidOverrideTargets } from './lib/copyUtils.js'
import { getDbaFunction } from './lib/db/getDbaFunction.js'
import { switchDbConnection } from './lib/db/switchDbConnection.js'
import { detectPayloadVersion } from './lib/detectPayloadVersion.js'
import { getEnv, setEnv } from './lib/env.js'

const basePath = '@whatworks/payload-switch-env/client'
const DangerBarPath = `${basePath}#DangerBar`
const AdminButtonPath = `${basePath}#AdminButton`
const SwitchDbConnectionViewPath = `${basePath}#SwitchDbConnectionView`

export function switchEnvPlugin<DBA>({
  buttonMode = 'switch',
  copy,
  db,
  developmentFileStorage = {
    mode: 'file-system',
  },
  developmentSafetyMode = true,
  enable = true,
  logDatabaseSize = false,
  payloadVersion,
  quickSwitch = false,
}: SwitchEnvPluginArgs<DBA>): Plugin {
  return async (config) => {
    const copyWarnings: string[] = []
    const developmentFileStorageMode = developmentFileStorage.mode
    config.admin = {
      ...(config.admin || {}),
      dependencies: {
        ...(config.admin?.dependencies || {}),
        [AdminButtonPath]: {
          type: 'component',
          path: AdminButtonPath,
        },
        [DangerBarPath]: {
          type: 'component',
          path: DangerBarPath,
        },
        [SwitchDbConnectionViewPath]: {
          type: 'component',
          path: SwitchDbConnectionViewPath,
        },
      },
    }

    if (!enable) {
      return config
    }

    // An undefined resolved version means "assume a current payload release" —
    // version gates treat unknown as at-least. Throwing here would take the
    // whole deployment down, so users on older payloads pin explicitly instead.
    const resolvedPayloadVersion = payloadVersion ?? detectPayloadVersion()
    if (resolvedPayloadVersion === undefined) {
      console.warn(
        '[payload-plugin-switch-env] Could not auto-detect the installed payload version — assuming a current release. ' +
          'If you are running payload < 3.83.0, pass the `payloadVersion` plugin argument explicitly.',
      )
    }

    if (process.env.NODE_ENV === 'development') {
      const developmentDbArgs = db.developmentArgs as object
      if (
        typeof developmentDbArgs === 'object' &&
        'url' in developmentDbArgs &&
        typeof developmentDbArgs.url === 'string' &&
        developmentDbArgs.url
      ) {
        if (
          !(
            developmentDbArgs.url.includes('localhost') ||
            developmentDbArgs.url.includes('127.0.0.1')
          )
        ) {
          if (developmentSafetyMode) {
            throw new Error(
              'Development database url does not contain "localhost" or "127.0.0.1". To disable this check, set the `developmentSafetyMode` plugin argument to false.',
            )
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              '\x1b[31mWARNING: Your development database url does not contain "localhost" or "127.0.0.1". You may be in danger of overwriting your production database!\x1b[0m',
            )
          }
        }
      }
    }

    const getDatabaseAdapter = getDbaFunction(db)
    const resolvedCopy = normalizeCopyConfig({
      copy,
      warn: (message) => {
        copyWarnings.push(message)
      },
    })
    warnOnInvalidOverrideTargets({
      collections: config.collections || [],
      copy: resolvedCopy,
      globals: config.globals || [],
      warn: (message) => {
        copyWarnings.push(message)
      },
    })

    config.admin = {
      ...(config.admin || {}),
      components: {
        ...(config.admin?.components || {}),
        actions: [
          ...(config.admin?.components?.actions || []),
          {
            path: AdminButtonPath,
            serverProps: {
              getEnv,
              mode: buttonMode,
              quickSwitch,
            },
          },
        ],
        header: [
          ...(config.admin?.components?.header || []),
          {
            path: DangerBarPath,
            serverProps: {
              getEnv,
            },
          },
        ],
        views: {
          ...(config.admin?.components?.views || {}),
          SwitchDbConnectionView: {
            Component: {
              path: SwitchDbConnectionViewPath,
              serverProps: {
                getDatabaseAdapter,
              },
            },
            path: '/switch-db-connection',
          },
        },
      },
    }

    config.globals = [...(config.globals || []), switchEnvGlobal]

    config.endpoints = [
      ...(config.endpoints || []),
      switchEndpoint({
        copy: resolvedCopy,
        developmentFileStorage,
        getDatabaseAdapter,
        getEnv,
        logDatabaseSize,
        payloadVersion: resolvedPayloadVersion,
        setEnv,
      }),
      copyEndpoint({
        copy: resolvedCopy,
        getDatabaseAdapter,
        getEnv,
        logDatabaseSize,
      }),
    ]

    config.collections = (config.collections || [])
      .map((collection) => addAccessSettingsToUploadCollection(collection, getEnv))
      .map((collection) =>
        addDevelopmentSettingsToUploadCollection(
          collection,
          getEnv,
          developmentFileStorage,
          resolvedPayloadVersion,
        ),
      )

    if (developmentFileStorageMode === 'file-system') {
      modifyThumbnailUrl(config, getEnv)
    }
    // Requires the cloud storage plugin to be listed before this plugin, so its
    // signed-URL endpoints and admin providers already exist on the config.
    wrapClientUploadEndpoints(config, getEnv, developmentFileStorage)
    const env = await getEnv()
    switchEnvironments(config, env, developmentFileStorage, resolvedPayloadVersion)

    const oldInit = config.onInit
    config.onInit = async (payload) => {
      for (const warning of copyWarnings) {
        payload.logger.warn(`[payload-plugin-switch-env] ${warning}`)
      }

      // We can't access the payload object (and thus the database) until init
      // So we check the database to see if we're in production or development
      // because the serverless funtion may have been destroyed (along with memory
      // and filesystem)
      const env = await getEnv(payload)
      if (env === 'production') {
        if (buttonMode === 'switch') {
          switchEnvironments(config, 'production', developmentFileStorage, resolvedPayloadVersion)
          await switchDbConnection(payload, 'production', getDatabaseAdapter)
        } else {
          // We never want to be in production env when using the 'copy' buttonMode
          await setEnv('development', payload)
        }
      }
      if (oldInit) {
        await oldInit(payload)
      }
    }

    config.db = getDatabaseAdapter(env)

    return config
  }
}

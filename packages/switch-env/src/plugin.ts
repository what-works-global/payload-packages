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
import { dropSupersededFilenameIndexes } from './lib/db/dropSupersededFilenameIndexes.js'
import { getDbaFunction } from './lib/db/getDbaFunction.js'
import { switchDbConnection } from './lib/db/switchDbConnection.js'
import {
  applyDevelopmentPrefixesBeforeStoragePlugin,
  confirmDevelopmentPrefixesAppliedBeforeStoragePlugin,
} from './lib/developmentPrefix.js'
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
  quickSwitch = false,
}: SwitchEnvPluginArgs<DBA>): Plugin {
  // Runs when `switchEnvPlugin({...})` is called — while the plugins array is being
  // built, before buildConfig applies the storage plugin listed ahead of this one —
  // so that plugin records the development prefix itself (see developmentPrefix.ts).
  if (enable && buttonMode === 'copy' && developmentFileStorage.mode === 'cloud-storage') {
    applyDevelopmentPrefixesBeforeStoragePlugin(developmentFileStorage)
  }

  return async (config) => {
    const initWarnings: string[] = []
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

    if (developmentFileStorage.mode === 'cloud-storage') {
      for (const slug of confirmDevelopmentPrefixesAppliedBeforeStoragePlugin(
        config.collections || [],
        developmentFileStorage,
      )) {
        initWarnings.push(
          `The storage plugin did not pick up the development prefix for "${slug}", so its development uploads are placed per request instead. ` +
            'Pass the same collections object to the storage plugin and to `developmentFileStorage.collections` to keep the ' +
            `\`${developmentFileStorage.prefix}/<collection prefix>/...\` layout.`,
        )
      }
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
        initWarnings.push(message)
      },
    })
    warnOnInvalidOverrideTargets({
      collections: config.collections || [],
      copy: resolvedCopy,
      globals: config.globals || [],
      warn: (message) => {
        initWarnings.push(message)
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
        addDevelopmentSettingsToUploadCollection(collection, getEnv, developmentFileStorage),
      )

    if (developmentFileStorageMode === 'file-system') {
      modifyThumbnailUrl(config, getEnv)
    }
    // Requires the cloud storage plugin to be listed before this plugin, so its
    // signed-URL endpoints and admin providers already exist on the config.
    wrapClientUploadEndpoints(config, getEnv, developmentFileStorage)
    const env = await getEnv()
    switchEnvironments(config, env, developmentFileStorage)

    const oldInit = config.onInit
    config.onInit = async (payload) => {
      for (const warning of initWarnings) {
        payload.logger.warn(`[payload-plugin-switch-env] ${warning}`)
      }

      // We can't access the payload object (and thus the database) until init
      // So we check the database to see if we're in production or development
      // because the serverless funtion may have been destroyed (along with memory
      // and filesystem)
      const env = await getEnv(payload)
      if (env === 'production') {
        if (buttonMode === 'switch') {
          switchEnvironments(config, 'production', developmentFileStorage)
          await switchDbConnection(payload, 'production', getDatabaseAdapter)
        } else {
          // We never want to be in production env when using the 'copy' buttonMode
          await setEnv('development', payload)
        }
      }
      // Heal databases first indexed before this plugin scoped upload filename
      // uniqueness to the storage prefix: drop the now-superseded global
      // `filename` unique index that mongoose's autoIndex leaves behind. Guarded
      // to the development cloud-storage database; a no-op elsewhere. Run before
      // the consumer's onInit so any upload writes it makes (seeding, fixtures)
      // hit the corrected index rather than the stale one. The DB connection and
      // compiled models already exist by now — this is the earliest plugin hook
      // where an index can be dropped, and it depends on nothing oldInit does.
      await dropSupersededFilenameIndexes({
        developmentFileStorage,
        env: await getEnv(payload),
        payload,
      })

      if (oldInit) {
        await oldInit(payload)
      }
    }

    config.db = getDatabaseAdapter(env)

    return config
  }
}

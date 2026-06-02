import { type Env, type SwitchEnvPluginArgs } from '../../types.js'

export const getDbaFunction =
  <DBA>(dbConfig: SwitchEnvPluginArgs<DBA>['db']) =>
  (env: Env) => {
    const isProduction = env === 'production'
    // Force `push: false` on the production adapter. For Drizzle (SQLite/Postgres)
    // adapters this means `connect()` never runs pushDevSchema against production —
    // the only safe path to change prod's schema is a proper migration. The check
    // sits upstream of PAYLOAD_FORCE_DRIZZLE_PUSH in the adapter's connect(), so it
    // cannot be overridden by the force-push the switch flow sets. Mongo ignores
    // the extra arg (it is schemaless).
    const productionArgs = {
      ...(dbConfig.productionArgs as Record<string, unknown>),
      push: false,
    } as DBA
    const dbaResult = dbConfig.function(isProduction ? productionArgs : dbConfig.developmentArgs)
    return dbaResult
  }

export type GetDatabaseAdapter = ReturnType<typeof getDbaFunction>

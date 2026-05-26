import { type Env, type SwitchEnvPluginArgs } from '../../types.js'

export const getDbaFunction =
  <DBA>(dbConfig: SwitchEnvPluginArgs<DBA>['db']) =>
  (env: Env) => {
    const isProduction = env === 'production'
    const dbaResult = dbConfig.function(
      isProduction ? dbConfig.productionArgs : dbConfig.developmentArgs,
    )
    return dbaResult
  }

export type GetDatabaseAdapter = ReturnType<typeof getDbaFunction>

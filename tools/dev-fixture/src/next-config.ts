import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

export interface DevNextConfigOptions {
  serverExternalPackages?: string[]
  turbopackRules?: NonNullable<NextConfig['turbopack']>['rules']
  /** Wrap with withPayload. Defaults to true. Set false for non-Payload sandboxes. */
  payload?: boolean
}

const extensionAlias = {
  '.cjs': ['.cts', '.cjs'],
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
}

const importRewriteLoader = fileURLToPath(new URL('./import-rewrite-loader.mjs', import.meta.url))

const defaultTurbopackRules: NonNullable<NextConfig['turbopack']>['rules'] = {
  '*.ts': [importRewriteLoader],
  '*.tsx': [importRewriteLoader],
}

export function defineDevNextConfig(options: DevNextConfigOptions = {}): NextConfig {
  const config: NextConfig = {
    webpack: (webpackConfig) => {
      webpackConfig.resolve.extensionAlias = extensionAlias
      return webpackConfig
    },
    turbopack: {
      rules: { ...defaultTurbopackRules, ...options.turbopackRules },
    },
  }

  if (options.serverExternalPackages?.length) {
    config.serverExternalPackages = options.serverExternalPackages
  }

  if (options.payload === false) return config

  return withPayload(config, { devBundleServerPackages: false })
}

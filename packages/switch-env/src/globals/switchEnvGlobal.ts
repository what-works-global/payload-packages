import type { GlobalConfig } from 'payload'

export const switchEnvGlobalSlug = 'switchEnv'

export const switchEnvGlobal: GlobalConfig = {
  slug: switchEnvGlobalSlug,
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'env',
      type: 'select',
      defaultValue: 'development',
      options: ['development', 'production'],
      required: true,
    },
  ],
}

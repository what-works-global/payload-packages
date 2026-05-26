// @ts-check

import { defineEslintConfig } from '../../eslint.shared.js'

export default defineEslintConfig({
  ignores: ['dev/.next/**', 'dev/next.config.mjs'],
  extra: [
    {
      files: ['src/traverseDocument/**/*.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      files: ['dev/**/*.ts'],
      rules: { 'no-console': 'off' },
    },
  ],
})

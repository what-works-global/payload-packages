// @ts-check

import { defaultESLintIgnores, sharedEslintConfig } from '../../eslint.shared.js'

export default [
  {
    ignores: [...defaultESLintIgnores, 'dev/.next/**', 'dev/next.config.mjs', 'dev/app/**/importMap.js'],
  },
  ...sharedEslintConfig,
  {
    files: ['src/traverseDocument/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['dev/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]

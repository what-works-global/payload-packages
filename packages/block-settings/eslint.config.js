import { defaultESLintIgnores, sharedEslintConfig } from '../../eslint.shared.js'

export default [
  ...defaultESLintIgnores,
  ...sharedEslintConfig,
  {
    ignores: ['dev/**/*.mjs', 'dev/**/*.cjs'],
  },
]

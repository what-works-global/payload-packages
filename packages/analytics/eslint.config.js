// @ts-check

import { defaultESLintIgnores, sharedEslintConfig } from '../../eslint.shared.js'

export default [
  {
    ignores: [...defaultESLintIgnores, 'dev/*.mjs', 'dev/*.cjs', 'tailwind.config.js'],
  },
  ...sharedEslintConfig,
]

// @ts-check

import { defineEslintConfig } from '../../eslint.shared.js'

export default defineEslintConfig({
  ignores: ['dev/**/*.mjs', 'dev/**/*.cjs'],
})

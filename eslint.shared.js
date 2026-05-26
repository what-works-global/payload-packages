// @ts-check

// @ts-expect-error -- no published types
import payloadEsLintConfig from '@payloadcms/eslint-config'

export const defaultESLintIgnores = [
  '**/.temp',
  '**/.*',
  '**/.git',
  '**/.hg',
  '**/.pnp.*',
  '**/.svn',
  '**/playwright.config.ts',
  '**/vitest.config.*',
  '**/tsconfig.tsbuildinfo',
  '**/README.md',
  '**/eslint.config.js',
  '**/payload-types.ts',
  '**/dist/',
  '**/.yarn/',
  '**/build/',
  '**/node_modules/',
  '**/temp/',
  '**/importMap.js',
  '**/(payload)/layout.tsx',
]

const baseLanguageOptions = {
  languageOptions: {
    parserOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
}

/**
 * @param {{ ignores?: string[]; extra?: unknown[] }} [options]
 */
export function defineEslintConfig(options = {}) {
  const { ignores = [], extra = [] } = options
  return [
    { ignores: [...defaultESLintIgnores, ...ignores] },
    ...payloadEsLintConfig,
    { rules: { 'no-restricted-exports': 'off' } },
    baseLanguageOptions,
    ...extra,
  ]
}

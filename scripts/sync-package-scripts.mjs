#!/usr/bin/env node
// Keeps every package's `scripts` block in sync with the shared conventions, the
// same way sync-publish-config.mjs keeps `publishConfig` derived from `exports`.
// Enforced scripts must match exactly; presence-only scripts (`dev`, `test:peer`)
// may vary per package but must exist. Everything else is left alone.
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const packagesDir = path.join(root, 'packages')

const check = process.argv.includes('--check')

const BASE_SCRIPTS = {
  build: 'tsdown',
  'check:exports': 'publint && node ../../scripts/check-package-exports.mjs',
  clean: 'rimraf {dist,*.tsbuildinfo}',
  lint: 'eslint',
  'lint:fix': 'eslint --fix',
  prepublishOnly: 'node ../../scripts/guard-publish.mjs && pnpm build',
  typecheck: 'tsc --noEmit',
}

// Scripts required whenever the package has a Payload dev sandbox (dev/payload.config.ts).
const PAYLOAD_DEV_SCRIPTS = {
  'dev:generate-importmap': 'pnpm dev:payload generate:importmap',
  'dev:generate-types': 'pnpm dev:payload generate:types',
  'dev:payload': 'cd dev && cross-env PAYLOAD_CONFIG_PATH=./payload.config.ts payload',
  'generate:importmap': 'pnpm dev:generate-importmap',
  'generate:types': 'pnpm dev:generate-types',
}

// Per-package exceptions to the enforced values above.
const OVERRIDES = {}

// Required to exist, but the value is package-specific:
// - `dev`: next dev flags vary (--turbo support differs per package).
// - `test:peer`: runs in CI (check job and the pinned-payload peer matrix); some
//   packages scope it to a smoke file, others run their whole suite. Added as
//   `vitest run` when missing.
const PRESENCE_DEFAULTS = {
  dev: 'next dev dev',
  'test:peer': 'vitest run',
}

let drift = 0

const entries = await fs.readdir(packagesDir, { withFileTypes: true })

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const pkgDir = path.join(packagesDir, entry.name)
  const pkgPath = path.join(pkgDir, 'package.json')
  let raw
  try {
    raw = await fs.readFile(pkgPath, 'utf8')
  } catch {
    continue
  }
  const pkg = JSON.parse(raw)

  const expected = {
    ...BASE_SCRIPTS,
    ...(existsSync(path.join(pkgDir, 'dev', 'payload.config.ts')) ? PAYLOAD_DEV_SCRIPTS : {}),
    ...(OVERRIDES[pkg.name] ?? {}),
  }

  const required = ['dev']
  if (existsSync(path.join(pkgDir, 'test'))) required.push('test:peer')

  const scripts = { ...(pkg.scripts ?? {}) }
  const problems = []

  for (const [name, value] of Object.entries(expected)) {
    if (scripts[name] !== value) {
      problems.push(`${name}: expected ${JSON.stringify(value)}`)
      scripts[name] = value
    }
  }

  for (const name of required) {
    if (!scripts[name]) {
      problems.push(`${name}: missing (default ${JSON.stringify(PRESENCE_DEFAULTS[name])})`)
      scripts[name] = PRESENCE_DEFAULTS[name]
    }
  }

  const sorted = Object.fromEntries(Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b)))
  const changed = JSON.stringify(pkg.scripts ?? {}) !== JSON.stringify(sorted)

  if (!changed) continue

  if (check) {
    console.error(`✘ ${pkg.name}: scripts out of sync`)
    for (const problem of problems) console.error(`    ${problem}`)
    if (problems.length === 0) console.error('    (ordering only)')
    drift++
    continue
  }

  pkg.scripts = sorted
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✓ ${pkg.name}: scripts updated${problems.length ? ` (${problems.join('; ')})` : ''}`)
}

if (check && drift > 0) {
  console.error(`\nRun \`pnpm sync:package-scripts\` and commit the result.`)
  process.exit(1)
}

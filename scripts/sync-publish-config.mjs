#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const packagesDir = path.join(root, 'packages')

const check = process.argv.includes('--check')

function mapPath(srcPath, kind) {
  if (typeof srcPath !== 'string') return srcPath
  if (!srcPath.startsWith('./src/')) return srcPath
  const rel = srcPath.slice('./src/'.length).replace(/\.tsx?$/, '')
  const ext = kind === 'types' ? '.d.ts' : '.js'
  return `./dist/${rel}${ext}`
}

function mapExportEntry(value) {
  if (typeof value === 'string') {
    return mapPath(value, 'import')
  }
  if (value && typeof value === 'object') {
    const mapped = {}
    for (const [key, sub] of Object.entries(value)) {
      mapped[key] = mapPath(sub, key === 'types' ? 'types' : 'import')
    }
    return mapped
  }
  return value
}

function mapExports(exports) {
  if (!exports || typeof exports !== 'object') return exports
  const mapped = {}
  for (const [subpath, value] of Object.entries(exports)) {
    mapped[subpath] = mapExportEntry(value)
  }
  return mapped
}

let drift = 0

const entries = await fs.readdir(packagesDir, { withFileTypes: true })

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const pkgPath = path.join(packagesDir, entry.name, 'package.json')
  let raw
  try {
    raw = await fs.readFile(pkgPath, 'utf8')
  } catch {
    continue
  }
  const pkg = JSON.parse(raw)
  if (pkg.private) continue
  if (!pkg.exports) continue

  const derived = {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
    ...(pkg.publishConfig ?? {}),
    main: mapPath(pkg.main, 'import'),
    types: mapPath(pkg.types, 'types'),
    exports: mapExports(pkg.exports),
  }

  const existing = JSON.stringify(pkg.publishConfig ?? {})
  const next = JSON.stringify(derived)

  if (existing === next) continue

  if (check) {
    console.error(`✘ ${pkg.name}: publishConfig is out of date.`)
    drift++
    continue
  }

  pkg.publishConfig = derived
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✓ ${pkg.name}: publishConfig updated`)
}

if (check && drift > 0) {
  console.error(`\nRun \`pnpm sync:publish-config\` and commit the result.`)
  process.exit(1)
}

#!/usr/bin/env node
// Guardrail against duplicate host packages in consumer apps: a package lists
// `payload`, an `@payloadcms/*` package, `react`, `react-dom` or `next` under
// `dependencies`, so it pins its own version instead of sharing the app's. Every
// `@payloadcms/*` package pins its siblings to an exact version, so the app's
// package manager installs a second copy for it, and a second `@payloadcms/ui`
// splits the admin's React contexts (e.g. `useUploadHandlers must be used within
// UploadHandlersProvider`). `@whatworks/payload-utilities@3.0.0` shipped
// `@payloadcms/ui` exactly like this.
//
// Invariant enforced: those packages appear only in `peerDependencies` (and
// `devDependencies` for the package's own tests and dev sandbox).
//
// Covers new packages automatically (globs packages/*).
import fs from 'node:fs'
import path from 'node:path'

const packagesDir = path.resolve(import.meta.dirname, '../packages')

const isHostPackage = (name) =>
  name === 'payload' ||
  name.startsWith('@payloadcms/') ||
  name === 'react' ||
  name === 'react-dom' ||
  name === 'next'

const problems = []
let checkedPackages = 0

for (const dir of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  const manifestPath = path.join(packagesDir, dir.name, 'package.json')
  if (!dir.isDirectory() || !fs.existsSync(manifestPath)) continue
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  checkedPackages++
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (isHostPackage(name)) {
        problems.push(`${manifest.name}: ${name} is listed in ${field}`)
      }
    }
  }
}

if (problems.length) {
  console.error('✖ Host packages must be peer dependencies:\n')
  for (const p of problems) console.error('  - ' + p)
  console.error(
    '\nMove each one to `peerDependencies` (with a `>=<min> <4`-style range) and to ' +
      '`devDependencies` (`catalog:`) for the package’s own tests.',
  )
  process.exit(1)
}

console.log(`✓ ${checkedPackages} package(s) take payload, @payloadcms/*, react and next as peers.`)

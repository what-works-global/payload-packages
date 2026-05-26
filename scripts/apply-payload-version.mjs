#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

const SYNC_TRACKED = [
  'payload',
  '@payloadcms/db-mongodb',
  '@payloadcms/db-postgres',
  '@payloadcms/db-sqlite',
  '@payloadcms/next',
  '@payloadcms/richtext-lexical',
  '@payloadcms/translations',
  '@payloadcms/ui',
]

const version = process.argv[2]
if (!version) {
  console.error('Usage: apply-payload-version.mjs <version>')
  process.exit(1)
}

const here = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const rootPkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf8'))

pkg.pnpm = pkg.pnpm ?? {}
pkg.pnpm.overrides = pkg.pnpm.overrides ?? {}
for (const name of SYNC_TRACKED) {
  pkg.pnpm.overrides[name] = version
}

await fs.writeFile(rootPkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Pinned ${SYNC_TRACKED.length} Payload packages to ${version}`)

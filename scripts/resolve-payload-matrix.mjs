#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const packagesDir = path.join(root, 'packages')

const raw = execSync(`npm view 'payload@^3' version --json`, { encoding: 'utf8' })
const parsed = JSON.parse(raw)
const latest3x = Array.isArray(parsed) ? parsed.at(-1) : parsed

const entries = await fs.readdir(packagesDir, { withFileTypes: true })
const include = []

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const dir = entry.name
  const pkgPath = path.join(packagesDir, dir, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  } catch {
    continue
  }
  const min = pkg.whatworks?.peerMatrix?.payload?.min
  if (!min) continue

  const cells = new Map([
    [min, 'min'],
    [latest3x, 'latest-3.x'],
  ])

  for (const [payloadVersion, label] of cells) {
    include.push({
      package: pkg.name,
      packageDir: `packages/${dir}`,
      payloadVersion,
      label,
    })
  }
}

const matrix = { include }
const json = JSON.stringify(matrix)
console.log(json)

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `matrix=${json}\n`)
}

#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const packagesDir = path.join(root, 'packages')

// ---------------------------------------------------------------------------
// Work out which packages the current diff actually affects.
//
// A change is "global" — it affects every package — when it touches anything
// outside packages/**: shared config, tools/** (every package dev-depends on
// @whatworks/dev-fixture), scripts/**, .github/**, the lockfile, etc.
//
// The one deliberate exception is .changeset/**. Those files are release
// bookkeeping that changes on EVERY changeset-release/main PR (consumed
// changesets are deleted), so treating them as global would force a full run
// on every release and defeat the point of scoping. We ignore them entirely.
//
// With no base ref (local runs, non-PR contexts) we can't diff, so we fall
// back to "everything" — the safe, build-all default.
// ---------------------------------------------------------------------------
function detectAffected() {
  const base = process.env.GITHUB_BASE_REF
  if (!base) return { all: true }

  try {
    execSync(`git fetch --no-tags --quiet origin ${base}`, { stdio: 'ignore' })
  } catch {
    // origin/<base> may already be present from a full-history checkout; keep going.
  }

  let diff
  try {
    // Three-dot: changes on HEAD since it diverged from the base branch.
    diff = execSync(`git diff --name-only origin/${base}...HEAD`, { encoding: 'utf8' })
  } catch {
    return { all: true } // couldn't diff — be safe and run everything.
  }

  const files = diff
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const affected = new Set()
  for (const file of files) {
    if (file.startsWith('.changeset/')) continue // release bookkeeping — never global.
    const match = file.match(/^packages\/([^/]+)\//)
    if (match) {
      affected.add(match[1])
    } else {
      return { all: true } // anything else is a shared/global change → run everything.
    }
  }

  return { all: false, affected }
}

const changes = detectAffected()

const raw = execSync(`npm view 'payload@^3' version --json`, { encoding: 'utf8' })
const parsed = JSON.parse(raw)
const latest3x = Array.isArray(parsed) ? parsed.at(-1) : parsed

const entries = await fs.readdir(packagesDir, { withFileTypes: true })
const include = []
const affectedDirs = []

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const dir = entry.name
  if (!changes.all && !changes.affected.has(dir)) continue // package not touched by this diff.

  const pkgPath = path.join(packagesDir, dir, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  } catch {
    continue
  }

  // Every affected package gets its lint/typecheck/build/etc. run in the check
  // job, whether or not it opts into the payload peer matrix.
  affectedDirs.push(dir)

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
// pnpm --filter args scoping the check job to only the affected packages.
const filterArgs = affectedDirs.map((dir) => `--filter ./packages/${dir}`).join(' ')
// Bare directory names for scripts that take a package allowlist (e.g. check:use-client).
const affectedList = affectedDirs.join(' ')
const hasWork = affectedDirs.length > 0

console.log(
  changes.all
    ? 'Global change detected — running all packages.'
    : `Affected packages: ${affectedDirs.join(', ') || '(none)'}`,
)
console.log(`matrix=${JSON.stringify(matrix)}`)
console.log(`filterArgs=${filterArgs}`)
console.log(`affectedList=${affectedList}`)
console.log(`hasWork=${hasWork}`)

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `matrix=${JSON.stringify(matrix)}`,
      `filterArgs=${filterArgs}`,
      `affectedList=${affectedList}`,
      `hasWork=${hasWork}`,
    ].join('\n') + '\n',
  )
}

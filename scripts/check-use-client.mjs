#!/usr/bin/env node
// Guardrail against the RSC-boundary bug: a source module declares `'use client'`
// (or `'use server'`), but the build merges it into a dist chunk that does NOT carry
// the directive at the top, so the component silently runs on the wrong side and
// throws at runtime (e.g. `Attempted to call useConfig() from the server`).
//
// Invariant enforced: every source module with a leading directive must land in a
// dist chunk whose first statement is that SAME directive. Sources are traced via
// each chunk's sourcemap, so a correctly-hoisted bundle passes and only genuinely
// dropped directives fail. In this monorepo the usual fix is `unbundle: true` in the
// package's tsdown.config.ts, which emits one file per module so directives survive.
//
// Run AFTER `pnpm build`. Covers new packages automatically (globs packages/*).
//
// Optional CLI args restrict the check to specific package directory names, e.g.
// `node scripts/check-use-client.mjs analytics select-search-field`. CI passes the
// affected-package list so the check only inspects packages it actually built (an
// unbuilt package has no dist/ and would otherwise false-fail). With no args every
// package is checked — the correct behaviour after a full `pnpm build`.
import fs from 'node:fs'
import path from 'node:path'

const packagesDir = path.resolve(import.meta.dirname, '../packages')
const SRC_EXT_RE = /\.(?:tsx|ts|jsx|js|mts|cts|mjs|cjs)$/
const only = new Set(process.argv.slice(2))

/** Returns 'use client' | 'use server' if it is the first statement, else null. */
function leadingDirective(code) {
  for (const raw of code.split('\n')) {
    const line = raw.trim().replace(/^﻿/, '')
    if (line === '' || line.startsWith('#!')) continue
    // Comments are allowed before a directive prologue.
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue
    const m = line.match(/^['"]use (client|server)['"]\s*;?$/)
    return m ? `use ${m[1]}` : null
  }
  return null
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const problems = []
let checkedDirectives = 0

const pkgs = fs
  .readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(packagesDir, d.name, 'package.json')))
  .filter((d) => only.size === 0 || only.has(d.name))

for (const pkg of pkgs) {
  const root = path.join(packagesDir, pkg.name)
  const srcDir = path.join(root, 'src')
  const distDir = path.join(root, 'dist')
  if (!fs.existsSync(srcDir)) continue

  // Source modules that declare a directive, keyed by absolute path.
  const srcDirectives = new Map()
  for (const file of walk(srcDir)) {
    if (!SRC_EXT_RE.test(file)) continue
    const directive = leadingDirective(fs.readFileSync(file, 'utf8'))
    if (directive) srcDirectives.set(file, directive)
  }
  if (srcDirectives.size === 0) continue

  if (!fs.existsSync(distDir)) {
    problems.push(
      `${pkg.name}: ${srcDirectives.size} source file(s) declare a directive but dist/ is missing — run \`pnpm build\` first.`,
    )
    continue
  }

  // For every emitted chunk, map each of its source modules → the chunk's own directive.
  // A source can legitimately appear in multiple chunks; each occurrence is checked.
  const sourceToChunks = new Map() // absSrcPath -> Array<{ chunkRel, directive }>
  for (const jsFile of walk(distDir)) {
    if (!jsFile.endsWith('.js')) continue
    const mapFile = jsFile + '.map'
    if (!fs.existsSync(mapFile)) continue
    let sources
    try {
      sources = JSON.parse(fs.readFileSync(mapFile, 'utf8')).sources ?? []
    } catch {
      continue
    }
    const chunkDirective = leadingDirective(fs.readFileSync(jsFile, 'utf8'))
    const chunkRel = path.relative(root, jsFile)
    for (const source of sources) {
      const abs = path.resolve(path.dirname(mapFile), source)
      if (!srcDirectives.has(abs)) continue
      if (!sourceToChunks.has(abs)) sourceToChunks.set(abs, [])
      sourceToChunks.get(abs).push({ chunkRel, directive: chunkDirective })
    }
  }

  for (const [absSrc, directive] of srcDirectives) {
    checkedDirectives++
    const srcRel = path.relative(root, absSrc)

    // Evidence = the same-path emitted file (covers entries / re-export barrels that
    // contribute no mappable code) + any chunk whose sourcemap traces back to this
    // source (covers a module bundled into a differently-named chunk). Dedupe by path.
    const evidence = new Map() // chunkRel -> directive
    const samePath = path.join(distDir, path.relative(srcDir, absSrc).replace(SRC_EXT_RE, '.js'))
    if (fs.existsSync(samePath)) {
      evidence.set(
        path.relative(root, samePath),
        leadingDirective(fs.readFileSync(samePath, 'utf8')),
      )
    }
    for (const { chunkRel, directive: chunkDirective } of sourceToChunks.get(absSrc) ?? []) {
      evidence.set(chunkRel, chunkDirective)
    }

    if (evidence.size === 0) {
      // Not traceable to any emitted chunk (no sourcemaps, or tree-shaken out). Don't
      // false-fail — but note it so a genuinely missing component isn't shipped silently.
      problems.push(
        `${pkg.name}: ${srcRel} declares "${directive}" but its code was not found in any dist chunk ` +
          `(check the build emits it and sourcemaps are on).`,
      )
      continue
    }
    for (const [chunkRel, chunkDirective] of evidence) {
      if (chunkDirective !== directive) {
        problems.push(
          `${pkg.name}: ${srcRel} declares "${directive}" but it was bundled into ${chunkRel}, ` +
            `which starts with ${chunkDirective ? `"${chunkDirective}"` : 'no directive'} — the RSC boundary was lost. ` +
            `Set \`unbundle: true\` in tsdown.config.ts.`,
        )
      }
    }
  }
}

if (problems.length) {
  console.error("✖ 'use client' / 'use server' directives were dropped in the build:\n")
  for (const p of problems) console.error('  - ' + p)
  console.error(
    '\nEvery source directive must survive into the dist chunk it lands in. ' +
      'In this monorepo that usually means `unbundle: true` in the package’s tsdown.config.ts.',
  )
  process.exit(1)
}

console.log(
  `✓ ${checkedDirectives} 'use client'/'use server' directive(s) preserved across dist output.`,
)

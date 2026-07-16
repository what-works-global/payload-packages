/**
 * Edge-bundle invariant guard. The redirect-serving entries must stay importable
 * from edge/worker runtimes, which forbids any value import of `payload`, `next*`
 * (except `next/server` in the Next middleware wrapper), or Node built-ins
 * (`node:*`). This walks the TRANSITIVE static import graph of each entry —
 * following relative specifiers, ignoring `import type` and dynamic `import()` —
 * and fails if a forbidden module is reached. `fileCache`'s lazy dynamic
 * `import('node:fs/promises')` is allowed precisely because it is dynamic.
 *
 * Dependency-free by design (Node built-ins only) so the guard has no bundle of
 * its own to worry about.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const isPayload = (spec: string) => spec === 'payload' || spec.startsWith('payload/')
const isNext = (spec: string) => spec === 'next' || spec.startsWith('next/')
const isNode = (spec: string) => spec.startsWith('node:')

type EntrySpec = {
  entry: string
  forbid: (spec: string) => boolean
}

const ENTRIES: EntrySpec[] = [
  {
    entry: 'src/exports/resolver.ts',
    forbid: (spec) => isPayload(spec) || isNext(spec) || isNode(spec),
  },
  {
    entry: 'src/exports/cache.ts',
    forbid: (spec) => isPayload(spec) || isNext(spec) || isNode(spec),
  },
  {
    // The Next wrapper is allowed to import `next/server`, nothing more risky.
    entry: 'src/exports/middleware.ts',
    forbid: (spec) => isPayload(spec) || isNode(spec) || (isNext(spec) && spec !== 'next/server'),
  },
]

/** Removes comments so example imports inside JSDoc are never parsed as real. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** True when every named specifier inside `{ … }` is `type`-prefixed (elided at runtime). */
const isPureTypeNamed = (clause: string): boolean => {
  const match = clause.match(/\{([\s\S]*)\}/)
  if (!match) {
    return false
  }
  const names = match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length > 0 && names.every((name) => /^type\s/.test(name))
}

/** Returns the module specifiers this file value-imports (type-only imports excluded). */
const valueImportSpecifiers = (filePath: string): string[] => {
  // Flatten whitespace so multiline imports parse without a `\s+`/`[\s\S]*?`
  // regex that ESLint (rightly) flags for super-linear backtracking.
  const source = stripComments(readFileSync(filePath, 'utf8')).replace(/\s+/g, ' ')
  const specs: string[] = []

  const fromRe = /\b(?:import|export) (type )?(.*?) from ['"]([^'"]+)['"]/g
  let match: null | RegExpExecArray
  while ((match = fromRe.exec(source)) !== null) {
    const [, statementType, clause, specifier] = match
    if (statementType) {
      continue // `import type …` / `export type …`
    }
    if (isPureTypeNamed(clause)) {
      continue // `import { type A, type B } from …`
    }
    specs.push(specifier)
  }

  // Side-effect imports: `import 'x'` (not `import('x')`, not `import x from 'x'`).
  const sideEffectRe = /\bimport ?['"]([^'"]+)['"]/g
  while ((match = sideEffectRe.exec(source)) !== null) {
    specs.push(match[1])
  }

  return specs
}

const resolveRelative = (fromFile: string, specifier: string): string => {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.jsx$/, '.tsx'),
    base,
    `${base}.ts`,
    join(base, 'index.ts'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`Cannot resolve "${specifier}" from ${fromFile}`)
}

/** Bare (non-relative) specifiers reachable through the transitive value-import graph. */
const transitiveBareImports = (entry: string): { spec: string; via: string }[] => {
  const entryFile = resolve(packageRoot, entry)
  const seen = new Set<string>([entryFile])
  const queue = [entryFile]
  const bare: { spec: string; via: string }[] = []

  while (queue.length > 0) {
    const file = queue.shift()!
    for (const specifier of valueImportSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(file, specifier)
        if (!seen.has(resolved)) {
          seen.add(resolved)
          queue.push(resolved)
        }
      } else {
        bare.push({ spec: specifier, via: file.slice(packageRoot.length + 1) })
      }
    }
  }

  return bare
}

describe('edge-bundle safety', () => {
  it.each(ENTRIES)('$entry has no forbidden static value imports', ({ entry, forbid }) => {
    const offenders = transitiveBareImports(entry).filter(({ spec }) => forbid(spec))
    expect(
      offenders,
      `forbidden static imports reached from ${entry}: ${offenders
        .map(({ spec, via }) => `${spec} (via ${via})`)
        .join(', ')}`,
    ).toEqual([])
  })
})

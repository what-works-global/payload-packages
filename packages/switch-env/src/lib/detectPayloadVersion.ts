import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Reads `payload`'s version from a package.json path, returning undefined for
 * anything that isn't a real payload package.json.
 */
const readPayloadPackageVersion = (pkgPath: string): string | undefined => {
  try {
    if (!fs.existsSync(pkgPath)) {
      return undefined
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      name?: string
      version?: string
    }
    if (pkg.name === 'payload' && typeof pkg.version === 'string') {
      return pkg.version
    }
  } catch {
    // unreadable file or malformed JSON
  }
  return undefined
}

/**
 * Looks for payload inside a single node_modules directory: first as a direct
 * entry (`node_modules/payload`), then inside the pnpm virtual store
 * (`node_modules/.pnpm/payload@<version>_<peers>/node_modules/payload`).
 *
 * The store scan matters for traced serverless bundles (e.g. Vercel lambdas):
 * file tracing resolves pnpm symlinks to their real store paths, so the bundle
 * can contain the store entry without the top-level `payload` symlink.
 */
const readVersionFromNodeModules = (nodeModulesDir: string): string | undefined => {
  const direct = readPayloadPackageVersion(path.join(nodeModulesDir, 'payload', 'package.json'))
  if (direct) {
    return direct
  }

  const storeDir = path.join(nodeModulesDir, '.pnpm')
  let entries: string[]
  try {
    entries = fs.readdirSync(storeDir)
  } catch {
    return undefined
  }

  const versions = new Set<string>()
  for (const entry of entries) {
    if (!entry.startsWith('payload@')) {
      continue
    }
    const version = readPayloadPackageVersion(
      path.join(storeDir, entry, 'node_modules', 'payload', 'package.json'),
    )
    if (version) {
      versions.add(version)
    }
  }
  // multiple distinct versions in one store is ambiguous — keep looking elsewhere
  if (versions.size === 1) {
    return [...versions][0]
  }
  return undefined
}

/**
 * Derives a runtime directory from the current stack trace. Unlike
 * `import.meta.url` — which bundlers compile to a build-machine path that does
 * not exist in the deployed bundle — stack frames carry the path of the chunk
 * actually executing, so walking up from it reaches the deployed app's
 * node_modules.
 */
const getCallerDirFromStack = (): string | undefined => {
  const stack = new Error().stack
  if (!stack) {
    return undefined
  }
  for (const line of stack.split('\n').slice(1)) {
    // "    at fn (/abs/path/file.js:1:2)", "    at /abs/path/file.js:1:2",
    // or the same with a file:// URL
    const match = line.match(/\(?((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?$/)
    if (!match) {
      continue
    }
    let filePath = match[1]
    if (filePath.startsWith('file://')) {
      try {
        filePath = fileURLToPath(filePath)
      } catch {
        continue
      }
    }
    if (path.isAbsolute(filePath)) {
      return path.dirname(filePath)
    }
  }
  return undefined
}

/**
 * Walks up from each start directory looking for an installed payload package,
 * checking both plain node_modules entries and the pnpm virtual store at every
 * level. Exported for tests; use {@link detectPayloadVersion}.
 */
export const findPayloadVersion = (startDirs: string[]): string | undefined => {
  for (const startDir of [...new Set(startDirs)]) {
    try {
      let dir = startDir
      while (true) {
        const version = readVersionFromNodeModules(path.join(dir, 'node_modules'))
        if (version) {
          return version
        }
        const parent = path.dirname(dir)
        if (parent === dir) {
          break
        }
        dir = parent
      }
    } catch {
      // unreadable directory — try the next start dir
    }
  }
  return undefined
}

/**
 * Runtime directories from which payload might be resolvable, most-specific
 * first. Shared by both detection strategies. Exported for tests.
 *
 * - this module's location — where the unbundled plugin sits in node_modules,
 *   and (via a bundler-inlined runtime `import.meta.url`) the executing chunk
 * - the executing file per the stack trace — the chunk's real runtime path in
 *   bundled server output (e.g. Vercel lambdas), where `import.meta.url` may be
 *   inlined to a nonexistent build-machine path instead
 * - the process working directory — last resort
 *
 * `process.cwd()` is deliberately last: in a pnpm monorepo on Vercel the
 * function's cwd is the workspace root, which has no top-level `payload`
 * symlink (pnpm only links payload into the consuming app's own node_modules),
 * so neither Node's resolver nor a node_modules walk finds payload there. The
 * module/stack dirs sit inside the app, whose node_modules does resolve it.
 */
export const getRuntimeDirs = (): string[] => {
  const dirs: string[] = []
  try {
    dirs.push(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    // import.meta.url may not be a file URL in some bundler outputs
  }
  const stackDir = getCallerDirFromStack()
  if (stackDir) {
    dirs.push(stackDir)
  }
  dirs.push(process.cwd())
  return [...new Set(dirs)]
}

/**
 * Asks payload itself where it is installed. `getDependencies` (exported from
 * `payload` since 3.0.0) resolves a package with Node's own resolver and reads
 * its package.json version. Because that helper executes *inside* the payload
 * package — which Next.js keeps in `serverExternalPackages` and never bundles —
 * its `import.meta.url` is the real runtime path even in traced serverless
 * bundles (e.g. Vercel lambdas), so it can validate payload's location wherever
 * payload itself loads. This makes it the most reliable strategy available.
 *
 * Resolution is attempted from each {@link getRuntimeDirs} candidate, not just
 * `process.cwd()`: getDependencies resolves `payload` *from the base dir passed
 * in*, and a monorepo's cwd (the workspace root) can't see payload at all (no
 * top-level symlink under pnpm). The directory of the module that imported
 * payload always can — it is the exact base from which the `import('payload')`
 * just above succeeded — so Node's resolver mirrors that working resolution
 * even when the deployed file layout defeats a raw filesystem walk.
 *
 * The import is dynamic so a payload build that unexpectedly lacks the export
 * (or a bundler that mangles the module) degrades to the filesystem fallback
 * instead of crashing config evaluation.
 */
const detectViaPayloadResolver = async (): Promise<string | undefined> => {
  try {
    const { getDependencies } = (await import('payload')) as {
      getDependencies?: (
        baseDir: string,
        requiredPackages: string[],
      ) => Promise<{ resolved: Map<string, { path: string; version: string }> }>
    }
    if (typeof getDependencies !== 'function') {
      return undefined
    }
    for (const baseDir of getRuntimeDirs()) {
      try {
        const { resolved } = await getDependencies(baseDir, ['payload'])
        const version = resolved.get('payload')?.version
        if (typeof version === 'string') {
          return version
        }
      } catch {
        // payload not resolvable from this base dir — try the next
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Detects the installed payload version.
 *
 * Primary strategy: payload's own `getDependencies` helper — see
 * {@link detectViaPayloadResolver}. Note that resolution-by-*our*-code is
 * deliberately avoided:
 * - `require('payload/package.json')` throws ERR_PACKAGE_PATH_NOT_EXPORTED —
 *   payload's `exports` map does not expose `./package.json`.
 * - `createRequire(import.meta.url).resolve('payload')` makes bundlers treat
 *   `payload` as a CJS require request. Payload is ESM-only and listed in
 *   Next.js' default `serverExternalPackages`, so Turbopack warns
 *   ("Package payload can't be external ... require() resolves to a
 *   EcmaScript module") and the rewritten call can break at runtime.
 * Payload's helper has neither problem: a plain `import('payload')` is the
 * one specifier bundlers always externalize, and the resolver runs inside the
 * unbundled payload package.
 *
 * Fallback: a plain filesystem walk for payload's package.json, which triggers
 * no bundler analysis ('payload' is only a path segment, never a module
 * specifier), starting from each {@link getRuntimeDirs} candidate.
 *
 * Returns undefined when nothing is found; callers should fall back to an
 * explicit `payloadVersion`.
 */
export const detectPayloadVersion = async (): Promise<string | undefined> => {
  const resolverVersion = await detectViaPayloadResolver()
  if (resolverVersion) {
    return resolverVersion
  }

  return findPayloadVersion(getRuntimeDirs())
}

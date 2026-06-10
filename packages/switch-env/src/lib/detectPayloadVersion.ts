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
 * Detects the installed payload version by walking up the directory tree
 * looking for payload's package.json.
 *
 * Module-resolution APIs are deliberately avoided:
 * - `require('payload/package.json')` throws ERR_PACKAGE_PATH_NOT_EXPORTED —
 *   payload's `exports` map does not expose `./package.json`.
 * - `createRequire(import.meta.url).resolve('payload')` makes bundlers treat
 *   `payload` as a CJS require request. Payload is ESM-only and listed in
 *   Next.js' default `serverExternalPackages`, so Turbopack warns
 *   ("Package payload can't be external ... require() resolves to a
 *   EcmaScript module") and the rewritten call can break at runtime.
 *
 * A plain filesystem walk triggers no bundler analysis ('payload' is only a
 * path segment, never a module specifier). Start dirs, in order:
 * - this module's location — correct when the plugin runs unbundled from
 *   node_modules (the peer-resolved payload sits alongside it in pnpm's store)
 * - the executing file per the stack trace — correct in bundled server output
 *   (e.g. Vercel lambdas), where import.meta.url is inlined to a build-machine
 *   path but the stack frame carries the chunk's real runtime path
 * - the process working directory — last-resort fallback for layouts where
 *   neither of the above lands inside the deployed app
 *
 * Returns undefined when nothing is found; callers should fall back to an
 * explicit `payloadVersion`.
 */
export const detectPayloadVersion = (): string | undefined => {
  const startDirs: string[] = []
  try {
    startDirs.push(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    // import.meta.url may not be a file URL in some bundler outputs
  }
  const stackDir = getCallerDirFromStack()
  if (stackDir) {
    startDirs.push(stackDir)
  }
  startDirs.push(process.cwd())

  return findPayloadVersion(startDirs)
}

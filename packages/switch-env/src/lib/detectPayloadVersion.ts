import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Detects the installed payload version by walking up the directory tree
 * looking for `node_modules/payload/package.json`, starting from this
 * module's location and falling back to the process working directory.
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
 * path segment, never a module specifier) and covers the real layouts:
 * - pnpm: the plugin's real path is `.pnpm/<id>/node_modules/@whatworks/...`,
 *   and the peer-resolved payload symlink sits in that same `node_modules`.
 * - npm/yarn hoisting: the walk reaches the project root's `node_modules`.
 * - bundled server output (`.next/server`): import.meta.url may point at a
 *   chunk or an inlined build-machine path; the cwd fallback walks up from
 *   the running app's root, where `node_modules/payload` lives.
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
  startDirs.push(process.cwd())

  for (const startDir of startDirs) {
    try {
      let dir = startDir
      while (true) {
        const pkgPath = path.join(dir, 'node_modules', 'payload', 'package.json')
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
            name?: string
            version?: string
          }
          if (pkg.name === 'payload' && typeof pkg.version === 'string') {
            return pkg.version
          }
        }
        const parent = path.dirname(dir)
        if (parent === dir) {
          break
        }
        dir = parent
      }
    } catch {
      // unreadable directory or malformed package.json — try the next start dir
    }
  }
  return undefined
}

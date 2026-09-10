import { defineDevNextConfig } from '@whatworks/dev-fixture/next-config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const base = defineDevNextConfig({
  // ffmpeg-static resolves its binary as path.join(__dirname, 'ffmpeg'), so bundling
  // it rewrites __dirname to the bundler's virtual root and every spawn fails with
  // ENOENT on a "/ROOT/..." path. libsql ships native bindings, which cannot be
  // bundled at all.
  serverExternalPackages: ['ffmpeg-static', '@libsql/client', 'libsql'],
})

export default {
  ...base,
  // Nothing statically imports the binary, so file tracing has no reason to find it.
  // Naming it explicitly is what puts the 45 MB executable inside the function — and
  // the build script fetches it first, because tracing a path that does not exist
  // yet silently includes nothing (see the `build` script's install.js call).
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
  // pnpm hoists to the workspace root, so tracing has to start there or it follows
  // symlinks out of the traced tree and silently drops what it finds.
  outputFileTracingRoot: path.resolve(dirname, '../..'),
}

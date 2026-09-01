import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { bundledPathHint } from '../src/core/convert.js'

describe('bundledPathHint', () => {
  it('recognises a bundler virtual root, where "install ffmpeg" is wrong advice', () => {
    // The real failure: ffmpeg-static is installed and its binary is on disk, but a
    // bundled __dirname turned a correct config into a path that never existed.
    const hint = bundledPathHint('/ROOT/node_modules/.pnpm/ffmpeg-static@5.3.0/x/ffmpeg')
    expect(hint).toMatch(/virtual root/)
    expect(hint).toMatch(/serverExternalPackages/)
  })

  it('still diagnoses a missing node_modules binary without the /ROOT/ marker', () => {
    // Webpack rewrites __dirname differently, so the marker is a bonus, not the test.
    expect(bundledPathHint('/srv/app/.next/server/node_modules/ffmpeg-static/ffmpeg')).toMatch(
      /inlined ffmpeg-static/,
    )
  })

  it('separates an un-downloaded binary from a rewritten path', () => {
    // Both are ENOENT on a node_modules path and the fixes are unrelated, so the
    // package directory existing is what tells them apart. This one really happened:
    // a stale onlyBuiltDependencies list meant Vercel installed ffmpeg-static with
    // no binary in it, and the bundler advice would have sent someone the wrong way.
    const installed = new URL('../node_modules/ffmpeg-static/ffmpeg', import.meta.url).pathname
    const hint = bundledPathHint(installed)
    if (existsSync(installed)) {
      expect(hint).toBeNull()
    } else {
      expect(hint).toMatch(/never downloaded/)
      expect(hint).toMatch(/onlyBuiltDependencies/)
    }
  })

  it('says nothing about paths it cannot explain', () => {
    // A plain missing system install: the ordinary message is the right one.
    expect(bundledPathHint('/usr/local/bin/ffmpeg')).toBeNull()
    expect(bundledPathHint('ffmpeg')).toBeNull()
  })

  it('says nothing when the binary is actually there', () => {
    expect(bundledPathHint(process.execPath.replace(/[^/]+$/, 'node_modules/x'))).not.toBeNull()
    expect(bundledPathHint(new URL('../node_modules', import.meta.url).pathname)).toBeNull()
  })
})

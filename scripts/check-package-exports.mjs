#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// attw's --pack uses `npm pack`, which does NOT apply publishConfig overrides.
// pnpm pack does. So we pack with pnpm, then run attw against the resulting tarball.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attw-pack-'))

try {
  const pack = spawnSync('pnpm', ['pack', '--pack-destination', tmpDir], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (pack.status !== 0) {
    process.exit(pack.status ?? 1)
  }
  const tgzFiles = fs.readdirSync(tmpDir).filter((name) => name.endsWith('.tgz'))
  if (tgzFiles.length !== 1) {
    console.error(
      `Expected exactly one .tgz in ${tmpDir}, found ${tgzFiles.length}: ${tgzFiles.join(', ')}`,
    )
    process.exit(1)
  }
  const tarball = path.join(tmpDir, tgzFiles[0])
  const attw = spawnSync('attw', [tarball, '--profile', 'esm-only', ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  process.exit(attw.status ?? 1)
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

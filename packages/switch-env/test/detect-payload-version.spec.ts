import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { detectPayloadVersion, findPayloadVersion } from '../src/lib/detectPayloadVersion.js'

const tmpDirs: string[] = []

const makeTree = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-env-detect-'))
  tmpDirs.push(root)
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(root, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content)
  }
  return root
}

const payloadPkg = (version: string) => JSON.stringify({ name: 'payload', version })

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe('detectPayloadVersion', () => {
  it("resolves the installed payload version via payload's own resolver", async () => {
    // the workspace has payload installed, so the primary strategy
    // (payload's exported getDependencies) must find a real version
    await expect(detectPayloadVersion()).resolves.toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('findPayloadVersion', () => {
  it('finds payload in a plain node_modules above the start dir', () => {
    const root = makeTree({
      'node_modules/payload/package.json': payloadPkg('3.84.1'),
    })
    expect(findPayloadVersion([path.join(root, 'apps', 'web', 'src')])).toBe('3.84.1')
  })

  it('finds payload in a pnpm virtual store without a top-level symlink (traced serverless bundle)', () => {
    const root = makeTree({
      'node_modules/.pnpm/payload@3.85.1_graphql@16.12.0/node_modules/payload/package.json':
        payloadPkg('3.85.1'),
    })
    // start dir mirrors a bundled chunk location inside the lambda
    expect(findPayloadVersion([path.join(root, '.next', 'server', 'chunks', 'ssr')])).toBe('3.85.1')
  })

  it('prefers the direct node_modules entry over the store', () => {
    const root = makeTree({
      'node_modules/.pnpm/payload@3.85.1_x/node_modules/payload/package.json': payloadPkg('3.85.1'),
      'node_modules/payload/package.json': payloadPkg('3.84.1'),
    })
    expect(findPayloadVersion([root])).toBe('3.84.1')
  })

  it('treats multiple distinct store versions at one level as ambiguous', () => {
    const root = makeTree({
      'node_modules/.pnpm/payload@3.80.0_x/node_modules/payload/package.json': payloadPkg('3.80.0'),
      'node_modules/.pnpm/payload@3.85.1_y/node_modules/payload/package.json': payloadPkg('3.85.1'),
    })
    expect(findPayloadVersion([root])).toBeUndefined()
  })

  it('dedupes store entries that differ only by peer suffix', () => {
    const root = makeTree({
      'node_modules/.pnpm/payload@3.85.1_x/node_modules/payload/package.json': payloadPkg('3.85.1'),
      'node_modules/.pnpm/payload@3.85.1_y/node_modules/payload/package.json': payloadPkg('3.85.1'),
    })
    expect(findPayloadVersion([root])).toBe('3.85.1')
  })

  it('ignores packages that are not actually payload', () => {
    const root = makeTree({
      'node_modules/payload/package.json': JSON.stringify({
        name: 'not-payload',
        version: '1.0.0',
      }),
    })
    expect(findPayloadVersion([root])).toBeUndefined()
  })

  it('falls through to later start dirs when earlier ones miss', () => {
    const empty = makeTree({})
    const withPayload = makeTree({
      'node_modules/payload/package.json': payloadPkg('3.84.1'),
    })
    expect(findPayloadVersion([empty, withPayload])).toBe('3.84.1')
  })
})

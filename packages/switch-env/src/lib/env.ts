import { existsSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

import type { Env, GetEnv, SetEnv } from '../types.js'

import { switchEnvGlobalSlug } from '../globals/switchEnvGlobal.js'

const tmpFile = path.posix.join(os.tmpdir(), 'payload-env.txt')

declare global {
  // eslint-disable-next-line no-var
  var env: Env | undefined
}

global.env = undefined

const isDev = process.env.NODE_ENV === 'development'

export const getEnv: GetEnv = async (payload) => {
  if (typeof global.env !== 'undefined') {
    return global.env
  } else if (isDev && existsSync(tmpFile)) {
    const env = readFileSync(tmpFile, 'utf-8') as Env
    setEnvCache(env)
    return env
  } else if (payload) {
    const switchEnvGlobal = await payload.findGlobal({
      slug: switchEnvGlobalSlug,
      depth: 0,
    })
    const env = switchEnvGlobal?.env ?? 'development'
    setEnvCache(env)
    return env
  } else {
    return 'development'
  }
}

export const setEnv: SetEnv = async (newEnv, payload) => {
  setEnvCache(newEnv)
  writeFileSync(tmpFile, newEnv)
  if (payload) {
    await payload.updateGlobal({
      slug: switchEnvGlobalSlug,
      data: {
        env: newEnv,
      },
    })
  }
}

export const setEnvCache = (newEnv: Env) => {
  global.env = newEnv
}

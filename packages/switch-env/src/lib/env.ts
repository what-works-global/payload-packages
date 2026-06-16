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

// On SQL adapters (Drizzle), querying the `switch_env` global before its table
// exists throws "no such table" (SQLite) / "does not exist" (Postgres) rather
// than returning null the way Mongo does. This happens on a brand-new database
// whose schema has not been pushed yet by the time `onInit` runs — most notably
// a fresh remote libsql/Turso database, where Drizzle's dev schema-push does not
// create tables. A missing table simply means there is no persisted switch
// state, which is equivalent to "development", so we must not let it crash init.
const isMissingTableError = (error: unknown): boolean => {
  // Drizzle wraps the driver error; the table name lives in the message and the
  // driver-specific phrasing in the (recursively nested) `cause`.
  let text = ''
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    text += ` ${current.message}`
    current = (current as { cause?: unknown }).cause
  }
  text = text.toLowerCase()
  return text.includes('no such table') || text.includes('does not exist')
}

export const getEnv: GetEnv = async (payload) => {
  if (typeof global.env !== 'undefined') {
    return global.env
  } else if (isDev && existsSync(tmpFile)) {
    const env = readFileSync(tmpFile, 'utf-8') as Env
    setEnvCache(env)
    return env
  } else if (payload) {
    let env: Env = 'development'
    try {
      const switchEnvGlobal = await payload.findGlobal({
        slug: switchEnvGlobalSlug,
        depth: 0,
      })
      env = switchEnvGlobal?.env ?? 'development'
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error
      }
      // Fresh database, schema not yet pushed: no switch state ⇒ development.
    }
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

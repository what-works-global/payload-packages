/**
 * Browser-storage helpers for the edit button. Everything here is guarded so
 * SSR passes and privacy modes that throw on storage access degrade to "no
 * hint" instead of crashing. React-free on purpose — the pure pieces
 * (`nearestCorner`, hint expiry) are unit-tested in a plain Node environment.
 */

/** Marks the browser as (possibly) an editor's. Set by the admin hint
 * provider and refreshed by every successful endpoint response. */
const HINT_KEY = 'payload-paths:editor'
/** Session verdict of the auth check: `'in'` or `'out'`. */
const SESSION_KEY = 'payload-paths:session'
/** The user's chosen corner for the button. */
const CORNER_KEY = 'payload-paths:corner'

/** Hints older than this are ignored — a stale mark from a long-gone login
 * should not make a shared machine probe the endpoint forever. */
const HINT_TTL_MS = 1000 * 60 * 60 * 24 * 30

export type Corner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

export const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

const safeGet = (storage: 'local' | 'session', key: string): null | string => {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage
    return store.getItem(key)
  } catch {
    return null
  }
}

const safeSet = (storage: 'local' | 'session', key: string, value: null | string): void => {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage
    if (value === null) {
      store.removeItem(key)
    } else {
      store.setItem(key, value)
    }
  } catch {
    // Storage unavailable (SSR, privacy mode) — the button just checks less.
  }
}

/** Pure hint-expiry check, exported for tests. */
export const isHintFresh = (
  raw: null | string,
  now: number,
  ttlMs: number = HINT_TTL_MS,
): boolean => {
  if (!raw) {
    return false
  }
  const stamped = Number(raw)
  return Number.isFinite(stamped) && now - stamped >= 0 && now - stamped < ttlMs
}

export const hasEditorHint = (): boolean =>
  typeof window !== 'undefined' && isHintFresh(safeGet('local', HINT_KEY), Date.now())

export const writeEditorHint = (): void => {
  if (typeof window !== 'undefined') {
    safeSet('local', HINT_KEY, String(Date.now()))
  }
}

export const clearEditorHint = (): void => {
  if (typeof window !== 'undefined') {
    safeSet('local', HINT_KEY, null)
  }
}

export type SessionVerdict = 'in' | 'out' | null

export const readSessionVerdict = (): SessionVerdict => {
  const value = typeof window === 'undefined' ? null : safeGet('session', SESSION_KEY)
  return value === 'in' || value === 'out' ? value : null
}

export const writeSessionVerdict = (verdict: Exclude<SessionVerdict, null>): void => {
  if (typeof window !== 'undefined') {
    safeSet('session', SESSION_KEY, verdict)
  }
}

const isCorner = (value: unknown): value is Corner => CORNERS.includes(value as Corner)

export const readCorner = (): Corner | null => {
  const value = typeof window === 'undefined' ? null : safeGet('local', CORNER_KEY)
  return isCorner(value) ? value : null
}

export const writeCorner = (corner: Corner): void => {
  if (typeof window !== 'undefined') {
    safeSet('local', CORNER_KEY, corner)
  }
}

/** Snap a drop point to the nearest viewport corner. Pure, for tests. */
export const nearestCorner = (
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): Corner => {
  const vertical = y < viewportHeight / 2 ? 'top' : 'bottom'
  const horizontal = x < viewportWidth / 2 ? 'left' : 'right'
  return `${vertical}-${horizontal}` as Corner
}

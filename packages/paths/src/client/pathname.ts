/**
 * Framework-agnostic pathname subscription. SPA routers (Next's app router
 * included) navigate via `history.pushState`/`replaceState`, which fire no
 * native event — the standard toolbar trick (Vercel toolbar, Next dev
 * overlay) is a one-time monkey-patch that re-dispatches them as a custom
 * event. Patched once per window (symbol-guarded, so two bundled copies of
 * this module still patch a single time) and never unpatched — the wrappers
 * delegate to the originals and are inert without listeners.
 */

const NAVIGATION_EVENT = 'payload-paths:navigation'
const PATCHED_FLAG = '__payloadPathsHistoryPatched'

const patchHistory = (): void => {
  const flagged = window as { [PATCHED_FLAG]?: boolean } & Window
  if (flagged[PATCHED_FLAG]) {
    return
  }
  flagged[PATCHED_FLAG] = true
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method]
    window.history[method] = function patched(this: History, ...args) {
      const result = original.apply(this, args)
      window.dispatchEvent(new Event(NAVIGATION_EVENT))
      return result
    } as History['pushState']
  }
}

/**
 * Call `onChange` with the new `location.pathname` whenever it changes via
 * SPA navigation (push/replace) or history traversal. Returns a cleanup
 * function. Safe to call only in the browser.
 */
export const subscribeToPathname = (onChange: (pathname: string) => void): (() => void) => {
  patchHistory()
  let last = window.location.pathname
  const handler = (): void => {
    const next = window.location.pathname
    if (next !== last) {
      last = next
      onChange(next)
    }
  }
  window.addEventListener('popstate', handler)
  window.addEventListener(NAVIGATION_EVENT, handler)
  return () => {
    window.removeEventListener('popstate', handler)
    window.removeEventListener(NAVIGATION_EVENT, handler)
  }
}

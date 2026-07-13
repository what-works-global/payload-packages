/**
 * Vercel exposes a per-request context on `globalThis`; its `waitUntil` keeps
 * the invocation alive after the response is sent until the promise settles.
 * This is the exact lookup `@vercel/functions` performs — reading the symbol
 * directly avoids a platform-specific dependency (and the bundler headaches of
 * dynamically importing an optional one). Anywhere else — local dev,
 * long-lived servers, scripts — the context is absent and this returns
 * `undefined`.
 */

interface VercelRequestContext {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined
}

export const getWaitUntil = (): ((promise: Promise<unknown>) => void) | undefined =>
  (globalThis as Record<symbol, undefined | VercelRequestContext>)[
    Symbol.for('@vercel/request-context')
  ]?.get?.()?.waitUntil

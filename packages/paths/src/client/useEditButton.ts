'use client'

/**
 * The headless half of the edit button: pathname tracking, the editor-hint
 * gate, the endpoint fetch, and per-path memoization. Exported so consumers
 * can keep the request logic and render their own shell.
 *
 * Request frugality, in order:
 * 1. No editor hint (and not a draft-mode session) → no request at all. The
 *    hint is stamped by the admin provider and by successful checks, so
 *    anonymous visitors never call the endpoint.
 * 2. A session-scoped 'out' verdict (a 401 this session) → no request.
 * 3. Confirmed editors pay ~one request per new pathname; responses are
 *    memoized per (pathname, scope, draft) for the life of the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { EditButtonContext } from '../core/editButtonContract.js'

import { DEFAULT_EDIT_BUTTON_ENDPOINT_PATH } from '../core/editButtonContract.js'
import { subscribeToPathname } from './pathname.js'
import {
  clearEditorHint,
  hasEditorHint,
  readSessionVerdict,
  writeEditorHint,
  writeSessionVerdict,
} from './storage.js'

export type UsePathsEditButtonOptions = {
  /** Payload's REST route. @default '/api' */
  apiRoute?: string
  /**
   * The current session is a preview/draft-mode session. Skips the editor-hint
   * gate (entering preview required the admin, which is hint enough) and asks
   * the endpoint to resolve newest-version content.
   */
  draft?: boolean
  /** The endpoint path configured on the plugin. @default '/paths/edit-button' */
  endpointPath?: string
  /** Seed the current pathname's context (skips its fetch entirely). */
  initial?: EditButtonContext
  /** Scope value (e.g. tenant id) for collections with a `scopeField`. */
  scope?: null | string
  /** Absolute origin of the Payload app when it is NOT same-origin. Requires
   * CORS + cookie configuration on the Payload side. */
  serverURL?: string
}

export type UsePathsEditButtonResult = {
  /** The endpoint response for the current pathname (when `status: 'ready'`). */
  context: EditButtonContext | null
  pathname: null | string
  /** Drop the memoized context for the current pathname and re-fetch. */
  refresh: () => void
  /** Forget this browser's editor state (hint + session) and hide — call
   * after logging the user out. */
  signOutLocally: () => void
  status: 'hidden' | 'loading' | 'ready'
}

/** Per-page-load memo of endpoint responses, keyed by (draft, scope, pathname). */
const contextCache = new Map<string, EditButtonContext>()

const cacheKey = (pathname: string, scope: null | string | undefined, draft: boolean): string =>
  `${draft ? '1' : '0'}|${scope ?? ''}|${pathname}`

export const usePathsEditButton = (
  options: UsePathsEditButtonOptions = {},
): UsePathsEditButtonResult => {
  const {
    apiRoute = '/api',
    draft = false,
    endpointPath = DEFAULT_EDIT_BUTTON_ENDPOINT_PATH,
    initial,
    scope = null,
    serverURL = '',
  } = options

  const [pathname, setPathname] = useState<null | string>(null)
  const [state, setState] = useState<{
    context: EditButtonContext | null
    status: 'hidden' | 'loading' | 'ready'
  }>({ context: null, status: 'hidden' })
  const [generation, setGeneration] = useState(0)
  const seededRef = useRef(false)

  // Pathname is read in an effect (never during render) so SSR and hydration
  // see identical output; the button only exists after mount anyway.
  useEffect(() => {
    setPathname(window.location.pathname)
    return subscribeToPathname(setPathname)
  }, [])

  useEffect(() => {
    if (pathname === null) {
      return
    }

    // A provided `initial` context seeds the first observed pathname once —
    // later navigations go through the endpoint as usual.
    const key = cacheKey(pathname, scope, draft)
    if (initial && !seededRef.current) {
      seededRef.current = true
      contextCache.set(key, initial)
      writeEditorHint()
    }

    const cached = contextCache.get(key)
    if (cached) {
      setState({ context: cached, status: 'ready' })
      return
    }

    // The gate: draft-mode sessions always check; everyone else needs a fresh
    // editor hint (or an 'in' verdict) and no 'out' verdict this session.
    const verdict = readSessionVerdict()
    if (!draft && (verdict === 'out' || (verdict !== 'in' && !hasEditorHint()))) {
      setState({ context: null, status: 'hidden' })
      return
    }

    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'loading' }))

    const query = new URLSearchParams({ pathname })
    if (scope !== null && scope !== undefined) {
      query.set('scope', scope)
    }
    if (draft) {
      query.set('draft', '1')
    }

    void fetch(`${serverURL}${apiRoute}${endpointPath}?${query.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          writeSessionVerdict('out')
          clearEditorHint()
          setState({ context: null, status: 'hidden' })
          return
        }
        if (!response.ok) {
          setState({ context: null, status: 'hidden' })
          return
        }
        const context = (await response.json()) as EditButtonContext
        writeSessionVerdict('in')
        writeEditorHint()
        contextCache.set(key, context)
        setState({ context, status: 'ready' })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ context: null, status: 'hidden' })
        }
      })

    return () => {
      controller.abort()
    }
  }, [apiRoute, draft, endpointPath, generation, initial, pathname, scope, serverURL])

  const refresh = useCallback(() => {
    if (pathname !== null) {
      contextCache.delete(cacheKey(pathname, scope, draft))
    }
    setGeneration((current) => current + 1)
  }, [draft, pathname, scope])

  const signOutLocally = useCallback(() => {
    clearEditorHint()
    writeSessionVerdict('out')
    contextCache.clear()
    setState({ context: null, status: 'hidden' })
  }, [])

  return { context: state.context, pathname, refresh, signOutLocally, status: state.status }
}

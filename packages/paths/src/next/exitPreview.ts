import { draftMode } from 'next/headers.js'

export type CreateExitPreviewRouteOptions = {
  /** Where to send the visitor when no `?redirect=` is supplied. @default '/' */
  defaultRedirect?: string
}

/**
 * Route-handler factory that ends a draft-mode session — draft mode can only
 * be disabled by a route handler inside the consuming Next app, so this ships
 * the one-liner instead of every app copying it:
 *
 * ```ts
 * // app/exit-preview/route.ts
 * import { createExitPreviewRoute } from '@whatworks/payload-paths/next'
 * export const GET = createExitPreviewRoute()
 * ```
 *
 * Pass the route's URL to `<PathsEditButton exitPreviewURL="/exit-preview" />`
 * — the button appends the current pathname as `?redirect=`. Only same-origin
 * relative redirects are honoured (anything else falls back to
 * `defaultRedirect`), so the route can't be abused as an open redirect.
 */
export const createExitPreviewRoute = (
  options: CreateExitPreviewRouteOptions = {},
): ((request: Request) => Promise<Response>) => {
  const { defaultRedirect = '/' } = options
  return async (request: Request): Promise<Response> => {
    const draft = await draftMode()
    draft.disable()
    const requested = new URL(request.url).searchParams.get('redirect') ?? defaultRedirect
    const safe = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'
    return Response.redirect(new URL(safe, request.url), 307)
  }
}

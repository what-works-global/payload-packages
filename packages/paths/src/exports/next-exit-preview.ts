/**
 * Dedicated entry for the exit-preview route handler. Separate from `/next`
 * for the same reason `/next/plugin` is: route handlers are bundled as
 * `app-route` modules, where `/next`'s `next/navigation` import is
 * unparsable. This entry touches only `next/headers`, which is safe there.
 */
export { createExitPreviewRoute, type CreateExitPreviewRouteOptions } from '../next/exitPreview.js'

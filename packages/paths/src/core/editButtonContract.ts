/**
 * The wire contract between the edit-button endpoint (server) and the
 * `@whatworks/payload-paths/client` component. Dependency-free on purpose:
 * this module is bundled into BOTH the core entry (endpoint) and the client
 * entry (browser), so it may not import `payload`, `react`, or Node built-ins.
 */

/** Where the endpoint is mounted under Payload's API route. */
export const DEFAULT_EDIT_BUTTON_ENDPOINT_PATH = '/paths/edit-button'

/**
 * Document version state, using the admin panel's vocabulary:
 * - `'published'` — live, no unpublished changes.
 * - `'changed'` — published, but a newer draft exists.
 * - `'draft'` — never published.
 * `null` when the collection has no drafts enabled.
 */
export type EditButtonDocStatus = 'changed' | 'draft' | 'published'

export type EditButtonAncestor = {
  /** Admin edit URL for the ancestor document. */
  editURL: string
  id: number | string
  title: string
  /** Public URL (prefix included) — shown as the subtitle in the trail. */
  url: string
}

export type EditButtonDoc = {
  /**
   * Ancestor documents derived from the path segments (root-first). Empty for
   * flat collections and top-level documents.
   */
  ancestors: EditButtonAncestor[]
  /** Admin REST/API view, or `null` when hidden via `admin.hideAPIURL`. */
  apiURL: null | string
  collection: string
  /** Singular label of the collection when configured as a string. */
  collectionLabel: string
  /** Admin edit view for the document — the button's primary action. */
  editURL: string
  id: number | string
  /** Stored (prefix-free) path the document resolved from. */
  path: string
  /** Admin live-preview view, or `null` when live preview is not configured. */
  previewURL: null | string
  status: EditButtonDocStatus | null
  /** Title via the collection's `useAsTitle` field, falling back to the path. */
  title: string
  /** `updatedAt` of the newest version (draft included), ISO string. */
  updatedAt: null | string
  /** Public URL (prefix included). */
  url: string
  /** Admin versions view, or `null` when versions are disabled. */
  versionsURL: null | string
}

export type EditButtonUser = {
  collection: string
  email: null | string
  id: number | string
}

export type EditButtonURLs = {
  /** Admin account view for the signed-in user. */
  account: string
  /** Admin dashboard. */
  admin: string
  /** REST logout endpoint for the user's auth collection (POST). */
  logout: string
}

/**
 * The endpoint's 200 response. `doc` is `null` when the pathname does not
 * resolve to a document in any configured collection — the component then
 * hides (or falls back to a dashboard-only button).
 */
export type EditButtonContext = {
  doc: EditButtonDoc | null
  urls: EditButtonURLs
  user: EditButtonUser
}

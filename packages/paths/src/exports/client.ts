export { PathsEditButton, type PathsEditButtonProps } from '../client/EditButton.js'
export { PathsEditorHintProvider } from '../client/EditorHintProvider.js'
export { clearEditorHint, type Corner, hasEditorHint, writeEditorHint } from '../client/storage.js'
export {
  usePathsEditButton,
  type UsePathsEditButtonOptions,
  type UsePathsEditButtonResult,
} from '../client/useEditButton.js'
/**
 * Browser entry — the floating edit button and its headless hook. Pure React
 * (no `next/*`, no `payload` runtime): drop `<PathsEditButton />` into any
 * React frontend served alongside Payload, enable `editButton` on the plugin,
 * and the button appears for logged-in editors only. Next.js apps can wrap it
 * with `NextPathsEditButton` from `@whatworks/payload-paths/next` for
 * draft-mode awareness.
 */
export {
  DEFAULT_EDIT_BUTTON_ENDPOINT_PATH,
  type EditButtonAncestor,
  type EditButtonContext,
  type EditButtonDoc,
  type EditButtonDocStatus,
  type EditButtonURLs,
  type EditButtonUser,
} from '../core/editButtonContract.js'

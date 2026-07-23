---
'@whatworks/payload-paths': minor
---

Add a floating frontend edit button that deep-links any page to its document in the admin.

- **`editButton` plugin option** (opt-in): registers an authenticated GET endpoint that resolves a pathname to its document across all configured collections (prefix-ranked, `/page/N` aware, draft fallback) and returns its status (`published`/`changed`/`draft`), last-updated time, an ancestor trail derived from the stored path, and ready-made admin URLs (edit, live preview, versions, API, dashboard, account, logout). Only admin-collection users are answered by default; override with `editButton.access`. Also registers a small admin provider that stamps an editor hint in `localStorage` — regenerate your import map after enabling.
- **New `@whatworks/payload-paths/client` entry**: `<PathsEditButton />`, a framework-agnostic React component — a corner-pinned dot that expands into an edit pill + actions menu, draggable to any viewport corner (persisted per browser). Anonymous visitors render nothing and make zero requests (hint-gated); confirmed editors pay ~one request per new path per session. `usePathsEditButton()` is exported for headless/custom UIs.
- **Next sugar**: `NextPathsEditButton` (draft-mode-aware server wrapper) in `@whatworks/payload-paths/next`, and `createExitPreviewRoute()` in the new `@whatworks/payload-paths/next/exit-preview` entry (kept separate because `/next`'s `next/navigation` import is unparsable in `app-route` modules).

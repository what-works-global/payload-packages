---
'@whatworks/payload-paths': patch
---

Fix: the boot backfill no longer invalidates the cache, which was logging `revalidateTag("payload-paths:<collection>") failed: … used "revalidateTag" during render which is unsupported` on every `next build` and cold-start page render.

`onInit` runs inside whatever first calls `getPayload()` — during `next build` that is the render of a page route, where Next forbids `revalidateTag`. So the backfill's post-repair `cache.invalidate(...)` threw and was swallowed: it produced an error line without ever busting a tag. The backfill is now a pure data-repair step with no cache side effects. Nothing is lost in practice — a cold process starts with an empty cache, and the normal `afterChange` hook still invalidates (in a legal context) the next time each repaired document is saved.

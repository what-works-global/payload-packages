---
'@whatworks/payload-paths': minor
---

Fix: the boot backfill now repairs version snapshots, not just the main row.

`backfillPaths` wrote `path` to the main collection document via `db.updateOne`, which never touches `_<collection>_versions`. On a **drafts-enabled** collection the admin list and every `draft: true` read come from the version snapshot — so a document imported without a path (or previously fixed by a main-only backfill) kept serving a pathless snapshot indefinitely, and `getPath`/`getDocUrl` threw on those reads even though the main row looked fixed.

- The backfill now repairs the **latest** and **latest published** version snapshot of each affected document (historical snapshots are left untouched), computing each from its own slug and the current parent chain. This runs **independently of the main-row count**, so installs whose main rows were already fixed still get their stale snapshots repaired on the next boot. `BackfillCollectionReport` gains a `versionsFixed` count.
- `verifyPathIntegrity` now also checks the latest version snapshot of drafts-enabled collections (and fixes it under `fix: true`); reported issues carry a `version: true` flag.
- The boot check now uses the lower-level `db.count`/`db.countVersions`/`db.find` (index-backed, skipping access control and the afterRead/`url`-virtual work a system task doesn't need), so a healthy collection costs one main-row count plus, for drafts collections, one version count.
- Those gate counts now run concurrently across collections, and the repair writes now run concurrently within a collection — both through a bounded pool that is ultimately capped by the database connection pool (e.g. Mongo's `maxPoolSize`), so it is safe on a pool as small as 3 and never conflicts (each write targets a distinct document). The concurrent gate matters because it is all a healthy install pays and it recurs on every serverless cold start, where serial counts cost `N × RTT` on the request path.
- **Removed the `backfillLimit` option** (both the plugin config and the `backfillPaths({ limit })` argument). The boot repair now always runs to completion, so `'fix'` never silently stops partway and leaves documents broken until a later boot. Its two rationales are covered elsewhere: writes are already rate-bounded by the internal concurrency cap, and a very large dirty collection should use `backfill: 'check'`/`'off'` plus an offline `backfillPaths({ mode: 'fix' })` run rather than a per-boot cap. **Migration:** remove any `backfillLimit` from your `pathsPlugin(...)` config — it no longer exists.

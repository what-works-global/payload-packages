---
'@whatworks/payload-activity-log': minor
---

Configure document snapshots separately for collections and globals, and add a new `'fallback'` mode.

`snapshot` is now an object — `{ collections?, globals? }` — instead of a single string. Each scope takes one mode or a `{ default, overrides }` map for per-slug control:

```ts
activityLogPlugin({
  snapshot: {
    collections: 'delete',
    globals: { default: 'never', overrides: { 'site-settings': 'always' } },
  },
})
```

A snapshot is a fallback for the version link, so the modes form a ladder — `never` < `delete` < `fallback` < `always`:

- `'never'` — never store document data.
- `'delete'` — (collections only) on permanent delete, the sole surviving record.
- `'fallback'` (new) — on delete, plus every change to an entity with **no versions enabled**, where there's no version link to fall back on. Versioned entities rely on the version link.
- `'always'` — every change.

Defaults are **collections `'delete'`** (unchanged) and **globals `'never'`**; opt individual globals in with `'fallback'`/`'always'`. Snapshotting a global remains independent of logging it.

**Breaking:** the string form (`snapshot: 'delete'`) is no longer accepted — pass `snapshot: { collections: 'delete' }`. The exported type `ActivitySnapshotMode` is replaced by `CollectionSnapshotMode`, `GlobalSnapshotMode`, `SnapshotScopeConfig`, and `ActivitySnapshotConfig`; `defaultSnapshotMode` is replaced by `defaultCollectionSnapshotMode` and `defaultGlobalSnapshotMode`.

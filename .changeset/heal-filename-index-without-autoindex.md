---
'@whatworks/payload-switch-env': patch
---

Fix the superseded-`filename`-index cleanup never running on the databases it targets.

1.2.8 added automatic dropping of the orphaned single-field `filename` unique index, but routed it through `model.init()` first. On exactly the databases that need healing, `model.init()` rejects: autoIndex can't build the schema's non-unique `filename` index while the stale unique index still occupies the `filename_1` name, so the drop never executed and the plugin instead logged a misleading `Could not drop the superseded single-field filename unique index … An existing index has the same name as the requested index` warning.

The cleanup now works the native collection directly instead of going through `model.init()`/autoIndex, and ensures the compound `(filename, prefix)` replacement index exists — creating it from the configured fields if autoIndex never managed to (it stops at the failed `filename_1` build, so the compound is often absent) — before dropping the old single-field unique index. A not-yet-created collection (`NamespaceNotFound`) is now treated as a silent no-op rather than a warning. Guards are unchanged: development environment, `cloud-storage` mode, and the mongoose adapter only.

---
'@whatworks/payload-switch-env': patch
---

Scope upload filename uniqueness to `(filename, prefix)` in `cloud-storage` mode.

In `cloud-storage` mode one database holds documents under different storage prefixes (development uploads under the development prefix, copied or production documents under the original prefix), and payload's duplicate-filename check is scoped to the incoming document's prefix. The default collection-wide unique index on `filename` doesn't match that layout: uploading a filename that exists under another prefix failed with "The following field is invalid: filename" even though the storage keys don't collide.

The plugin now sets `upload.filenameCompoundIndex: ['filename', 'prefix']` on every upload collection listed in `developmentFileStorage.collections` with a `prefix` (unless `filenameCompoundIndex` is already set). The same filename can then exist under different prefixes, while duplicates within a prefix still deduplicate normally (`file-1.zip`, `file-2.zip`, ...).

This changes the collection's indexes. If the plugin is disabled in some environments, set `filenameCompoundIndex` explicitly in the collection config so the schema is identical with and without the plugin. Existing databases keep their old unique index until migrated — a schema migration on SQL adapters; on MongoDB the old unique index must be dropped manually. See the README section "Duplicate filenames in `cloud-storage` mode".

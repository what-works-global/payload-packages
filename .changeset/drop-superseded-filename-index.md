---
'@whatworks/payload-switch-env': patch
---

Automatically drop the superseded single-field `filename` unique index on MongoDB in `cloud-storage` mode.

Scoping upload filename uniqueness to `(filename, prefix)` makes payload build a compound `{ filename: 1, prefix: 1 }` unique index instead of the single-field `{ filename: 1 }` one. But a database first indexed before that change keeps the orphaned unique `filename_1` index: mongoose's `autoIndex` only _creates_ missing indexes, it never drops ones that have left the schema, and the new non-unique `filename_1` it wants (from the field's `index: true`) collides by name with the old unique one, so the old one simply lingers. That leftover global unique index keeps rejecting same-filename/different-prefix documents — including production documents copied into development under their original prefix — with a duplicate-key error surfaced as `ValidationError: filename`, defeating the compound-index fix on already-provisioned databases.

The plugin now drops that superseded index itself, on init and after a runtime switch into development, for every upload collection it scopes with `filenameCompoundIndex`. It is best-effort and tightly guarded: development environment only (never the production database, where the single-field unique index is legitimate), `cloud-storage` mode only, the mongoose adapter only (drizzle reconciles indexes via schema push), and only once the compound replacement index already exists — so the collection is never left without filename uniqueness. This removes the manual "drop the old unique index on MongoDB" migration step noted previously.

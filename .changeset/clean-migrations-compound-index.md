---
"@whatworks/payload-switch-env": patch
---

Keep generated migrations clean: don't declare the compound `(filename, prefix)` upload index while payload is generating a migration.

In development cloud-storage mode the plugin scopes upload filename uniqueness to the storage prefix by setting `upload.filenameCompoundIndex = ['filename', 'prefix']`. That declaration is correct at runtime — the development database picks the compound index up via the schema push that runs after a copy — but it also leaked into `payload migrate:create`'s schema diff, producing a migration that drops the default single-field `filename` unique index and adds the compound one. Because migrations describe the production / file-system baseline and run against production, that swap was wrong there (and surfaced whenever migrations were authored with a staging-flavoured environment active).

The plugin now suppresses `filenameCompoundIndex` when payload's CLI is running a migration command (detected the same way payload's own bin resolves it — the first positional arg starting with `migrate`), so generated migrations keep the single-field unique index regardless of which environment they're authored in. Runtime config is unchanged, so the development cloud-storage database still gets the compound index. The `createdDuringDevelopment` / storage-mode upload fields are unaffected.

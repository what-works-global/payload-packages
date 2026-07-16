---
'@whatworks/payload-rbac': patch
---

Fix `onInit` crashing on MongoDB with "Cannot run 'count' in a multi-document transaction" (263) when an app seeds its first user in `onInit`.

The `assignFirstUserRole` bootstrap hook checked for existing users with an unfiltered `payload.count`, which the mongoose adapter runs via `estimatedDocumentCount` — the Mongo `count` command, which is rejected inside a transaction. On a replica set (Atlas), a plain `payload.create` for the first user opens a transaction, so the hook ran the forbidden count inside it and failed the whole boot (e.g. every `next build` page-data worker). The check is now a `find` with `pagination: false`, which issues no count command and works with or without an active transaction. This is the real cause of the 263 that `0.2.4`'s `disableTransaction` change did not address (that fixed rbac's own seed writes, not this hook).

Also harden the roles index build against concurrent-boot churn: `ensureRolesIndexes` now retries the full transient MongoDB error class (write-concern/step-down errors such as "operation was interrupted"), not just `WriteConflict`, since `createIndexes` is idempotent and only needs to survive the race. New `isTransientMongoError` helper is exported alongside `isWriteConflict`.

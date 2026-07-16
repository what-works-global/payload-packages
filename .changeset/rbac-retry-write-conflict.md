---
'@whatworks/payload-rbac': patch
---

Fix a MongoDB `WriteConflict` (code 112) that could fail `onInit` — and so the whole build (`payloadInitError: true`) — the first time the plugin is added to a replica-set-backed (e.g. Atlas) app. On a fresh database the roles collection's index is still being built, and a transactional seed write to a collection with an in-progress index build is aborted with a transient write conflict. Seeding now retries transient write conflicts (with bounded backoff) for both the index build and the role create/update writes, mirroring the existing concurrent-boot unique-violation handling. The mongoose `createIndexes` call is invoked bound to its model, so it no longer fails with "`Model.createIndexes()` cannot run without a model as `this`". Exposes `isWriteConflict` and `retryOnWriteConflict` helpers.

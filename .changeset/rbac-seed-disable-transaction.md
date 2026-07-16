---
'@whatworks/payload-rbac': patch
---

Fix `onInit` seeding still failing on a fresh replica-set (e.g. Atlas) database — the retry added in 0.2.2 did not cover the real cause. `next build` collects page data across several worker processes at once, so many Payload instances seed the same fresh database concurrently, and on a replica set Payload wraps each write in a transaction. A transactional write against a not-yet-created collection is aborted with `OperationNotSupportedInTransaction` (263) — which is not a write conflict, so retrying could not help and every concurrent boot could fail at once. Separately, the concurrent-boot duplicate handling never actually worked on MongoDB: the mongoose adapter rewraps the duplicate-key error (11000) into a Payload `ValidationError` that drops the code, so `isUniqueViolation` never matched it.

Seeding now runs its writes with `disableTransaction: true` (seeding is a set of independent single-document inserts that need no atomic guarantee, and dropping the transaction removes the whole 112/263 failure class), and detects a lost create race by re-checking that the role exists rather than by matching error codes, so it survives the adapter's `ValidationError` rewrap. Verified end-to-end against an in-memory replica set with concurrent boots (`test:mongo`).

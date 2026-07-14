---
'@whatworks/payload-rbac': patch
---

Prevent duplicate predefined roles from a concurrent-boot seed race. `onInit` runs on every serverless cold start, and the non-atomic find-then-create in the role seeder let two concurrent boots both create the same role when the unique constraint on `name` wasn't yet enforced.

- On MongoDB, the unique index on `roles.name` is now built (`createIndexes()`) before seeding runs, so the constraint is live before the first `create` — independent of the consumer's `ensureIndexes`/`autoIndex` adapter config. If the collection already contains duplicate names the build is skipped with a clear log pointing to manual cleanup, rather than throwing on every boot. SQL adapters are unaffected (the constraint rides their table DDL/migrations).
- The seeder now swallows a lost race idempotently on any adapter via a dialect-agnostic unique-violation check (MongoDB `11000`, Postgres `23505`, SQLite `SQLITE_CONSTRAINT_UNIQUE`).

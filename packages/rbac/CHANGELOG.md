# @whatworks/payload-rbac

## 0.2.4

### Patch Changes

- ba05cdb: Fix `onInit` seeding still failing on a fresh replica-set (e.g. Atlas) database — the retry added in 0.2.2 did not cover the real cause. `next build` collects page data across several worker processes at once, so many Payload instances seed the same fresh database concurrently, and on a replica set Payload wraps each write in a transaction. A transactional write against a not-yet-created collection is aborted with `OperationNotSupportedInTransaction` (263) — which is not a write conflict, so retrying could not help and every concurrent boot could fail at once. Separately, the concurrent-boot duplicate handling never actually worked on MongoDB: the mongoose adapter rewraps the duplicate-key error (11000) into a Payload `ValidationError` that drops the code, so `isUniqueViolation` never matched it.

  Seeding now runs its writes with `disableTransaction: true` (seeding is a set of independent single-document inserts that need no atomic guarantee, and dropping the transaction removes the whole 112/263 failure class), and detects a lost create race by re-checking that the role exists rather than by matching error codes, so it survives the adapter's `ValidationError` rewrap. Verified end-to-end against an in-memory replica set with concurrent boots (`test:mongo`).

## 0.2.3

### Patch Changes

- 66682f6: Fix `onInit` failing with "`Model.createIndexes()` cannot run without a model as `this`" on the mongoose adapter. The write-conflict retry added in 0.2.2 called the roles-collection index build as a bare, detached function, stripping the `this` mongoose requires; it is now bound to its model.

## 0.2.2

### Patch Changes

- 7d327f6: Fix a MongoDB `WriteConflict` (code 112) that could fail `onInit` — and so the whole build (`payloadInitError: true`) — the first time the plugin is added to a replica-set-backed (e.g. Atlas) app. On a fresh database the roles collection's index is still being built, and a transactional seed write to a collection with an in-progress index build is aborted with a transient write conflict. Seeding now retries transient write conflicts (with bounded backoff) for both the index build and the role create/update writes, mirroring the existing concurrent-boot unique-violation handling. Exposes `isWriteConflict` and `retryOnWriteConflict` helpers.

## 0.2.1

### Patch Changes

- 3576066: Prevent duplicate predefined roles from a concurrent-boot seed race. `onInit` runs on every serverless cold start, and the non-atomic find-then-create in the role seeder let two concurrent boots both create the same role when the unique constraint on `name` wasn't yet enforced.

  - On MongoDB, the unique index on `roles.name` is now built (`createIndexes()`) before seeding runs, so the constraint is live before the first `create` — independent of the consumer's `ensureIndexes`/`autoIndex` adapter config. If the collection already contains duplicate names the build is skipped with a clear log pointing to manual cleanup, rather than throwing on every boot. SQL adapters are unaffected (the constraint rides their table DDL/migrations).
  - The seeder now swallows a lost race idempotently on any adapter via a dialect-agnostic unique-violation check (MongoDB `11000`, Postgres `23505`, SQLite `SQLITE_CONSTRAINT_UNIQUE`).

## 0.2.0

### Minor Changes

- 8d99730: Wildcard permissions: `'<slug>:*'` grants every action on one collection or global, and `'*:<action>'` grants one action on every controlled entity, present and future (`'*:create'`/`'*:delete'` only ever match collections). Every check is wildcard-aware — access control, `hasPermission`/`requirePermission`, and the privilege-escalation guards, where holding `'pages:*'` covers granting `'pages:read'` and holding every action on an entity covers granting its `'<slug>:*'`, while `'*:<action>'` (like `'*'`) is only covered by holding it. A role whose `'*:<action>'` wildcards span all four actions is equivalent to `'*'` and counts as full access for the admin-role and break-glass guards. The permissions matrix renders wildcard grants as checked, locked cells and adds an "Everything" row for the `'*:<action>'` wildcards. New exports: `permissionCovers` and `fullAccessPermissions`.

## 0.1.0

### Minor Changes

- fda087e: Initial release: role based access control with database-defined roles, a per-collection CRUD checkbox matrix, code-predefined roles seeded on init, automatic access enforcement across collections and globals, privilege-escalation protection, a built-in `adminRole` locked to full access (it can never be downgraded, renamed, or deleted, can only be assigned by users who already hold it, is auto-assigned to the first user, and always has at least one holder — stripping or deleting the last administrator is blocked, and if the database is damaged so that no administrator exists at all, any signed-in user may claim the role for themselves as a break-glass recovery), opt-in `protected` roles locked to their code definition, and per-role credential protection (`credentialChanges: 'self'`, always on for the admin role) so a protected account's password, email, and username can only be changed by the account owner. Changing a user's roles requires the `roles:update` permission — the roles field renders read-only in the admin panel for everyone else — and a role your remaining roles could not re-grant cannot be removed from your own account, so users can never accidentally strip their own access.

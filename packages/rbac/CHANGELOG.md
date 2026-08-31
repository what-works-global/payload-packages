# @whatworks/payload-rbac

## 0.6.0

### Minor Changes

- b67f1c2: Add `seedRoles` to skip role seeding on init, for connections that cannot write.

  Seeding builds the roles collection's indexes before its first `create`, and an
  index build is itself a write, so a read-only credential fails init with
  `user is not allowed to do action [createIndex] on [<db>.roles]` before any
  application code runs. That blocks validating an app against production data —
  or any read-only replica — through the plugin.

  `seedRoles: false` skips the index build and the seed writes together; nothing
  else changes, so access control still behaves exactly as it does in production.
  Only safe when the roles already exist: an unseeded database has no roles, so no
  user can hold one. Defaults to `true`, so existing configs are unaffected.

## 0.5.0

### Minor Changes

- 8d66d08: feat(rbac): opt-in `compose` for access the config already defines, and an init notice for permissions that may be inert

  The plugin only ever filled gaps in access control: an operation with an access function of its own kept it, and the matching RBAC permission never ran. Nothing errored — the permission was simply inert, which is easy to miss when the function came from another plugin or from a collection written before the plugin was added. Two additive changes make that visible and fixable:

  - **`compose: { [slug]: RbacAction[] }`** opts individual entities and actions into `yourAccess AND permissionCheck` instead of standing aside. Both functions receive the same args and are awaited; results are ANDed the way Payload combines queries (`false` denies, `true` is the identity, two `Where` constraints become one `{ and: [...] }`), and the permission check is skipped when the existing function already denies. Listed actions with no existing function are plain gap fills, and unlisted entities/actions are untouched. `readVersions` follows `read`, `unlock` follows `update`. Unknown slugs, uncontrolled slugs, the roles collection, and actions an entity does not have throw at startup instead of quietly doing nothing. The AND itself is exported as `composeAccess`/`andAccessResults` for hand-written access.
  - **A single informational log on init** names every controlled collection and global that defines access of its own, together with the operations affected, and points at `requirePermission` and `compose` as the fixes. It is informational because the plugin cannot know whether those functions already check permissions; operations opted into `compose` are excluded, nothing is logged when there is nothing to report, and `quiet: true` silences it.

  Gap-filling remains the default for every collection, global and action, unchanged: composing by default would break public access — a collection whose `create` is `() => true` for anonymous submissions would start requiring a role that anonymous requests can never hold.

## 0.4.0

### Minor Changes

- ac18f12: The roles collection now defaults to the label **"User Roles"** (singular "User Role") and is placed directly after the last user/auth collection in the admin nav instead of at the end of the collection list.

  - **Default labels** are `{ singular: 'User Role', plural: 'User Roles' }`. Override them as before via `rolesCollection.override`. The permissions matrix row for the roles collection is labelled "User Roles" to match.
  - **Nav order**: the plugin inserts the roles collection immediately after the last collection in `userCollections` (the resolved auth collections, or `admin.user`), so roles sit next to the users they govern. It still appends at the end when no user collection is present.

## 0.3.0

### Minor Changes

- 03fbafd: Credential protection is now on by default for every user with a role. The password, email, and username of a user can be changed only by the account owner — anyone else is directed to a password-reset email — unless the user's roles are all opted out. This closes credential takeover out of the box instead of requiring a per-role opt-in.

  - **`credentialChanges` defaults to `'self'`** (was `'anyone'`).
  - **Roles created in the admin panel are self-only too**, always — the protection is built in, not a per-role setting, so it needs no field on the roles collection. `'anyone'` exists only as an explicit opt-out on a role you predefine in code.
  - A user is exempt only when **every** role they hold is a predefined role marked `credentialChanges: 'anyone'`; holding one self-only role (including any database-defined role) keeps them protected. The `adminRole` is always `'self'`.

  **Behavior change:** if you relied on the previous default — any user with `users:update` changing another user's credentials — mark the relevant predefined roles `credentialChanges: 'anyone'`. A user whose only roles are database-defined can no longer have their credentials changed by others at all; give them a predefined `'anyone'` role if that is required.

  **API:** `ProtectCredentialsArgs` now takes `anyoneRoleNames` (the opt-out list) instead of `selfOnlyRoleNames`; the guard is installed on every user collection unconditionally.

- fb824b8: Administrators can only be managed by administrators. When an `adminRole` is configured, a user who does not hold it can no longer create, update, or delete an account that does — regardless of their `users:create`/`users:update`/`users:delete` permissions, and regardless of full access (`'*'`) held through another role. Holding the admin role is the only key.

  This closes two gaps left by the existing guards: a non-administrator could previously edit non-credential fields of an administrator's document (only credentials were locked), and could delete any administrator except the last one (only the final holder was guarded). Both are now blocked outright.

  Administrators still manage each other normally, subject to the last-holder guard; writes without a user (local API, seeds, first-user bootstrap) and the break-glass self-claim are unaffected. Exposes `createProtectAdminUsersChangeHook`, `createProtectAdminUsersDeleteHook`, and `findRoleIdByName`.

## 0.2.5

### Patch Changes

- 6744889: Fix `onInit` crashing on MongoDB with "Cannot run 'count' in a multi-document transaction" (263) when an app seeds its first user in `onInit`.

  The `assignFirstUserRole` bootstrap hook checked for existing users with an unfiltered `payload.count`, which the mongoose adapter runs via `estimatedDocumentCount` — the Mongo `count` command, which is rejected inside a transaction. On a replica set (Atlas), a plain `payload.create` for the first user opens a transaction, so the hook ran the forbidden count inside it and failed the whole boot (e.g. every `next build` page-data worker). The check is now a `find` with `pagination: false`, which issues no count command and works with or without an active transaction. This is the real cause of the 263 that `0.2.4`'s `disableTransaction` change did not address (that fixed rbac's own seed writes, not this hook).

  Also harden the roles index build against concurrent-boot churn: `ensureRolesIndexes` now retries the full transient MongoDB error class (write-concern/step-down errors such as "operation was interrupted"), not just `WriteConflict`, since `createIndexes` is idempotent and only needs to survive the race. New `isTransientMongoError` helper is exported alongside `isWriteConflict`.

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

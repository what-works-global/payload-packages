# @whatworks/payload-rbac

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

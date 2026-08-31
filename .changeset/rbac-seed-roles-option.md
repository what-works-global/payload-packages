---
'@whatworks/payload-rbac': minor
---

Add `seedRoles` to skip role seeding on init, for connections that cannot write.

Seeding builds the roles collection's indexes before its first `create`, and an
index build is itself a write, so a read-only credential fails init with
`user is not allowed to do action [createIndex] on [<db>.roles]` before any
application code runs. That blocks validating an app against production data —
or any read-only replica — through the plugin.

`seedRoles: false` skips the index build and the seed writes together; nothing
else changes, so access control still behaves exactly as it does in production.
Only safe when the roles already exist: an unseeded database has no roles, so no
user can hold one. Defaults to `true`, so existing configs are unaffected.

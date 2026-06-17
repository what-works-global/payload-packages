---
'@whatworks/payload-switch-env': minor
---

Support the database copy flow on Postgres (`@payloadcms/db-postgres`).

The `copy` button and switch-with-copy both route SQL adapters through a backup/restore step that was implemented only for SQLite's libSQL client — on Postgres it failed immediately with `expected SQLite adapter with a libSQL client` (it reached for `sqlite_master`, `PRAGMA`, and `?` placeholders that don't exist there).

The SQL path now dispatches by adapter: SQLite keeps replaying captured DDL, while Postgres materializes the development schema with Drizzle's push, truncates it, and bulk-loads production's rows over a `pg` pool. Foreign-key enforcement is suspended for the load with `SET LOCAL session_replication_role = 'replica'`, JSON/JSONB columns are re-serialized so node-postgres doesn't mangle them, and identity sequences are advanced past the restored rows so later development inserts don't collide. Restore only ever writes to the development database; production is never mutated.

Adds a Postgres integration suite (mirroring the SQLite one, backed by an in-process `embedded-postgres` cluster) covering field-type round-trips, copy-config modes, side tables, migration rows, and sequence reset.

---
'@whatworks/payload-switch-env': patch
---

Stop `onInit` from crashing on a fresh SQL database whose schema has not been pushed yet.

On a brand-new database the `switch_env` global's table may not exist by the time the plugin's `onInit` runs — most notably a fresh remote libsql/Turso database, where Drizzle's dev schema-push does not create tables. `getEnv(payload)` queried the global anyway, and the driver threw `no such table: switch_env` (SQLite) / `does not exist` (Postgres), taking down the whole app at init.

`getEnv` now treats a missing global table as "no persisted switch state" and returns `development` instead of throwing. Other query errors still propagate unchanged, and MongoDB (which returns `null` rather than throwing) is unaffected.
